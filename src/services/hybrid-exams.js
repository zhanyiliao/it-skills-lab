import path from 'node:path';
import { createHash } from 'node:crypto';
import { root } from '../paths.js';
import { aiBanks, aiDifficultyMax, bankForCode } from './ai-banks.js';
import { drawDifficulty, sampleByDifficulty } from './difficulty.js';
import { createPaper, questionTextHtml } from './exam-paper.js';
import { loadQuestionPrompt, validateQuestions } from './ai-questions.js';
import { readPaper } from './exam-paper.js';
import { now, options, fail } from '../support.js';
import { questionContentHash } from './question-content.js';

   const normalize = text => text.normalize('NFKC').replace(/\s+/gu,'').toLowerCase();
   const digest = text => createHash('sha256').update(text).digest('hex');
   function shuffled(items, random = Math.random) {
     const result=[...items];
     for(let i=result.length-1;i>0;i--){const j=Math.min(i,Math.floor(random()*(i+1)));[result[i],result[j]]=[result[j],result[i]];}
     return result;
   }
   function planFormalExam(random = Math.random) {
     const extra=new Set(shuffled(aiBanks,random).slice(0,2).map(bank=>bank.id));
     const allocation=aiBanks.map(bank=>({bank:bank.id,bank_code:bank.code,total:extra.has(bank.id)?7:6,database:extra.has(bank.id)?4:3}));
     const remaining=30-allocation.reduce((sum,bank)=>sum+bank.database,0);
     const priorities=shuffled(allocation,random).sort((a,b)=>(b.total*0.6-Math.floor(b.total*0.6))-(a.total*0.6-Math.floor(a.total*0.6)));
     for(const bank of priorities.slice(0,remaining))bank.database++;
     return allocation.map(bank=>({...bank,generated:bank.total-bank.database}));
   }
   const plainQuestion = row => ({
     id:Number(row.id),bank:bankForCode(row.bank_code).id,question:row.question,
     options:Object.fromEntries(options.map(option=>[option,row[option]])),
     answer:row.answer,explanation:row.explanation,difficulty:row.difficulty,
   });


   function validateFormalPaper(exam) {
     const snapshot=readPaper(exam.snapshot);
     if(exam.mode!=='formal'||exam.source!=='hybrid'||snapshot.questions.length!==50||
       snapshot.difficulty_scale!==aiDifficultyMax||!Array.isArray(exam.origins)||exam.origins.length!==50||
       !Array.isArray(exam.generated_questions)||exam.generated_questions.length!==20||
       !Array.isArray(exam.bank_plan)||exam.bank_plan.length!==8||exam.generation?.reviewed!==true||
       !/^[a-f0-9]{64}$/.test(exam.generation.prompt_version??''))fail(409,'正式考卷資料不完整。');
     const counts=new Map(aiBanks.map(bank=>[bank.id,{total:0,database:0,generated:0}]));
     const databaseIds=new Set(),generatedIndices=new Set(),bankStems=new Set(),newStems=new Set();
     for(let start=0;start<20;start+=5){
       const batch=exam.generated_questions.slice(start,start+5);
       validateQuestions({questions:batch},batch.map(q=>({bank:q.bank,difficulty:q.difficulty})));
     }
     for(const [index,origin] of exam.origins.entries()){
       const group=counts.get(origin.bank),q=snapshot.questions[index];
       if(!group||q.bank_name!==aiBanks.find(bank=>bank.id===origin.bank).name)fail(409,'正式考卷題庫對應不正確。');
       group.total++;
       if(origin.kind==='bank'){
         if(!Number.isSafeInteger(origin.question_id)||origin.question_id<1||databaseIds.has(origin.question_id))fail(409,'正式考卷題目參照不正確。');
         databaseIds.add(origin.question_id);group.database++;bankStems.add(normalize(q.question));
       }else if(origin.kind==='generated'){
         if(!Number.isInteger(origin.index)||origin.index<0||origin.index>=20||generatedIndices.has(origin.index))fail(409,'正式考卷新題對應不正確。');
         generatedIndices.add(origin.index);group.generated++;
         const raw=exam.generated_questions[origin.index];
         if(raw.bank!==origin.bank||questionTextHtml(raw.question)!==q.question||raw.answer!==q.correct_answer||
           raw.difficulty!==q.difficulty||raw.explanation!==q.explanation||
           options.some(option=>questionTextHtml(raw.options[option])!==q.options[option]))fail(409,'正式考卷新題與固定內容不一致。');
         const stem=normalize(q.question);if(newStems.has(stem))fail(409,'正式考卷新題重複。');newStems.add(stem);
       }else fail(409,'正式考卷來源不正確。');
     }
     if(databaseIds.size!==30||generatedIndices.size!==20||[...newStems].some(stem=>bankStems.has(stem)))fail(409,'正式考卷來源比例不正確。');
     const planned=new Set();
     for(const bank of exam.bank_plan){
       const actual=counts.get(bank.bank);
       if(!actual||planned.has(bank.bank)||bank.bank_code!==aiBanks.find(item=>item.id===bank.bank).code||
         ![6,7].includes(bank.total)||![3,4].includes(bank.database)||
         ![2,3].includes(bank.generated)||bank.generated!==bank.total-bank.database||actual.total!==bank.total||
         actual.database!==bank.database||actual.generated!==bank.generated)fail(409,'正式考卷各科題數不正確。');
       planned.add(bank.bank);
     }
     return snapshot;
   }

   class HybridExamService {
     constructor(questions,generator){this.questions=questions;this.generator=generator;this.busy=false;}
     async review(databaseQuestions,generated,rules,signal){
       const prompt=rules+'\n\n## 目前為獨立審查模式\n只回傳審查 Schema，不生成 questions。逐題解答並檢查新題與原題的細節考點。'+
         '\n\n## 原本資料庫的30題（只作為比對基準，不審查它們彼此重疊）\n'+JSON.stringify(databaseQuestions)+
         '\n\n## 待審查的20題新題（index為0起算）\n'+JSON.stringify(generated.map((question,index)=>({index,...question})));
       const output=await this.generator.run(signal,()=>{},{
         kind:'formal-review',schema:path.join(root,'src/schemas/formal-question-review.json'),prompt,
         databaseQuestions,questions:generated,
       });
       signal?.throwIfAborted();
       let data;
       try{data=JSON.parse(output);}catch{fail(502,'新題檢查結果無法讀取，請重新產生考卷。');}
       const reviews=data?.reviews,ids=new Set(databaseQuestions.map(q=>q.id));
       if(!Array.isArray(reviews)||reviews.length!==20||new Set(reviews.map(q=>q.index)).size!==20)fail(502,'新題檢查結果不完整。');
       for(const row of reviews){
         if(!Number.isInteger(row.index)||row.index<0||row.index>=20||typeof row.quality_ok!=='boolean'||typeof row.overlap!=='boolean'||
           !Array.isArray(row.conflicting_database_ids)||row.conflicting_database_ids.some(id=>!ids.has(id))||
           !Array.isArray(row.conflicting_generated_indices)||row.conflicting_generated_indices.some(index=>!Number.isInteger(index)||index<0||index>=20||index===row.index)||
           typeof row.reason!=='string'||!row.reason.trim()||row.reason.length>1000)fail(502,'新題檢查資料不正確。');
       }
       return reviews;
     }
     async prepare({signal,onProgress=()=>{}}={}){
       if(this.busy||this.generator.busy)fail(429,'目前有考卷正在產生，請稍後再試。');
       this.busy=true;
       try{
         signal?.throwIfAborted();onProgress('preparing',{completed:0,total:20});
         const bankPlan=planFormalExam(),banks=aiBanks.map(bank=>bank.id);
         const rows=await this.questions.approvedRows(aiBanks.map(bank=>bank.code));
         const databaseQuestions=bankPlan.flatMap(bank=>{
           const items=rows.filter(row=>row.bank_code===bank.bank_code);
           if(items.length<bank.database)fail(422,aiBanks.find(item=>item.id===bank.bank).name+'的已通過題目不足，無法建立正式考卷。');
           return sampleByDifficulty(items,bank.database).map(plainQuestion);
         });
         const files=['ai-exam.md','formal-exam.md',...aiBanks.map(bank=>bank.prompt)];
         const documents=await Promise.all(files.map(file=>loadQuestionPrompt(path.join(root,'prompts',file))));
         const rules=documents.slice(0,2).join('\n\n')+'\n\n'+aiBanks.map((bank,index)=>
           '## 題庫：'+bank.id+'（'+bank.name+'）\n'+documents[index+2]).join('\n\n');
         const assigned=shuffled(bankPlan.flatMap(bank=>Array.from({length:bank.generated},()=>({bank:bank.bank,difficulty:drawDifficulty()}))));
         const plans=Array.from({length:4},(_,batch)=>assigned.slice(batch*5,batch*5+5));
         const context='## 已固定的正式考卷各科題數\n'+JSON.stringify(bankPlan)+'\n只生成分配的新題，不能修改或重抽原本30題。';
         let generated=await this.generator.generatePlanned({plans,banks,rules,context,avoidQuestions:databaseQuestions,signal,onProgress});
         let passed=false,reviewAttempts=0;
         for(let attempt=1;attempt<=3;attempt++){
           reviewAttempts=attempt;onProgress('validating',{completed:20,total:20,attempt});
           const reviews=await this.review(databaseQuestions,generated,rules,signal),failed=new Set();
           for(const row of reviews){
             if(!row.quality_ok||row.overlap||row.conflicting_database_ids.length||row.conflicting_generated_indices.length){
               failed.add(row.index);for(const index of row.conflicting_generated_indices)failed.add(index);
             }
           }
           if(!failed.size){passed=true;break;}
           if(attempt===3)break;
           const batches=[...new Set([...failed].map(index=>Math.floor(index/5)))].sort((a,b)=>a-b);
           const retained=generated.filter((_,index)=>!batches.includes(Math.floor(index/5)));
           const feedback=reviews.filter(row=>failed.has(row.index)).map(row=>({index:row.index,question:generated[row.index].question,reason:row.reason}));
           const replacement=await this.generator.generatePlanned({
             plans:batches.map(index=>plans[index]),banks,rules,context:context+'\n## 上次審查發現的問題，必須改正並避開相同細節\n'+JSON.stringify(feedback),
             avoidQuestions:[...databaseQuestions,...retained],signal,
             onProgress:()=>onProgress('validating',{completed:20,total:20,attempt:attempt+1,retrying:true}),
           });
           let cursor=0;for(const batch of batches)for(let offset=0;offset<5;offset++)generated[batch*5+offset]=replacement[cursor++];
         }
         if(!passed)fail(502,'新題的內容或考點檢查未通過，請重新產生正式考卷。');
         signal?.throwIfAborted();
         const mixed=shuffled([
           ...databaseQuestions.map(question=>({question,origin:{kind:'bank',bank:question.bank,question_id:question.id}})),
           ...generated.map((question,index)=>({question,origin:{kind:'generated',bank:question.bank,index}})),
         ]);
         const paper=createPaper(mixed.map(item=>item.question),50,banks,{allowRepeatedStems:true});
         const exam={...paper,mode:'formal',source:'hybrid',bank_plan:bankPlan,origins:mixed.map(item=>item.origin),
           generated_questions:generated,generation:{reviewed:true,review_attempts:reviewAttempts,prompt_version:digest(rules),created_at:now()}};
         validateFormalPaper(exam);
         return exam;
       }finally{this.busy=false;}
     }
     async commitQuestions(db,exam){
       validateFormalPaper(exam);
       const ids=[];
       const ordered=exam.generated_questions.map((question,index)=>({question,index,hash:questionContentHash(question)})).sort((a,b)=>a.hash.localeCompare(b.hash));
       for(const {question,index,hash} of ordered){
         const [result]=await db.execute(`INSERT INTO questions
           (bank_code,question,A,B,C,D,answer,explanation,difficulty,review_status,content_hash,generator,prompt_version,generation_batch,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,'approved',?,?,?,?,?)
           ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
           [aiBanks.find(bank=>bank.id===question.bank).code,question.question,...options.map(option=>question.options[option]),
             question.answer,question.explanation,question.difficulty,hash,'codex-cli',
             exam.generation.prompt_version,'formal-'+exam.nonce,now()]);
         ids[index]=Number(result.insertId);
       }
       return ids;
     }
   }

export { planFormalExam, HybridExamService, validateFormalPaper, questionContentHash };
