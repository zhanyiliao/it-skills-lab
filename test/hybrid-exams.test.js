import test from 'node:test';
import assert from 'node:assert/strict';
import { questionBanks } from '../src/services/question-banks.js';
import { createPaper } from '../src/services/exam-paper.js';
import { questionContentHash } from '../src/services/question-content.js';
import { CodexQuestionGenerator } from '../src/services/ai-questions.js';
import { HybridExamService, planFormalExam, validateFormalPaper } from '../src/services/hybrid-exams.js';

   const fixture = (plan,serial) => ({questions:plan.map((item,index)=>({...item,question:'新題 '+serial+' '+index+' '+item.bank,
     options:{A:'甲',B:'乙',C:'丙',D:'丁'},answer:'B',explanation:'依題設推導，乙成立。'}))});
   const approved = () => questionBanks.flatMap(bank=>Array.from({length:10},(_,index)=>({
     id:bank.code*100+index+1,bank_code:bank.code,question:'原題 '+bank.id+' '+index,A:'甲',B:'乙',C:'丙',D:'丁',answer:'B',explanation:'原題解析',difficulty:4,
   })));
   const passReviews = questions => ({reviews:questions.map((q,index)=>({index,quality_ok:true,overlap:false,
     conflicting_database_ids:[],conflicting_generated_indices:[],reason:'已獨立檢查正解與細節考點。'}))});
   function service({review=task=>passReviews(task.questions),rows=approved()}={}){
     let serial=0;const tasks=[],progress=[];
     const generator=new CodexQuestionGenerator(async(signal,report,task)=>{
       signal?.throwIfAborted();tasks.push(task);report();
       return JSON.stringify(task.kind==='formal-review'?await review(task):fixture(task.plan,++serial));
     });
     const source={approvedRows:async codes=>{assert.deepEqual(codes,[0,1,2,3,4,5,6,7]);return rows;}};
     return {hybrid:new HybridExamService(source,generator),generator,tasks,progress,options:{onProgress:(stage,counts)=>progress.push({stage,...counts})}};
   }
   test('formal allocation balances all eight banks and totals exactly forty-five existing plus five new questions',()=>{
     let state=12345;const random=()=>((state=(1664525*state+1013904223)>>>0)/2**32),large=new Set();
     for(let run=0;run<1000;run++){
       const plan=planFormalExam(random);
       assert.equal(plan.length,8);assert.equal(new Set(plan.map(q=>q.bank_code)).size,8);
       assert.equal(plan.reduce((s,q)=>s+q.total,0),50);assert.equal(plan.reduce((s,q)=>s+q.database,0),45);assert.equal(plan.reduce((s,q)=>s+q.generated,0),5);
       assert.equal(plan.filter(q=>q.total===7).length,2);
       for(const q of plan){
         assert.ok([6,7].includes(q.total));assert.ok([5,6,7].includes(q.database));assert.ok([0,1].includes(q.generated));
         assert.equal(q.database+q.generated,q.total);assert.ok(Math.abs(q.database-q.total*0.9)<1);
         if(q.total===7)large.add(q.bank);
       }
     }
     assert.equal(large.size,8);
   });
   test('formal preparation fixes database questions first, supplies complete avoidance material and builds an immutable fifty-question paper',async()=>{
     const s=service(),exam=await s.hybrid.prepare(s.options);
     assert.equal(exam.mode,'formal');assert.equal(exam.source,'hybrid');assert.equal(exam.snapshot.difficulty_scale,9);
     assert.equal(exam.snapshot.questions.length,50);assert.equal(exam.origins.filter(q=>q.kind==='bank').length,45);
     assert.equal(exam.generated_questions.length,5);assert.equal(s.tasks.filter(q=>q.kind==='questions').length,1);
     const review=s.tasks.find(q=>q.kind==='formal-review');assert.equal(review.databaseQuestions.length,45);
     for(const task of s.tasks.filter(q=>q.kind==='questions')){
       for(const q of review.databaseQuestions)assert.ok(task.prompt.includes(q.question));
       assert.match(task.prompt,/formal|正式/);assert.equal(task.plan.length,5);
     }
     validateFormalPaper(exam);assert.equal(s.hybrid.busy,false);assert.equal(s.generator.busy,false);
   });
   test('semantic overlap rebuilds five new questions, keeps the original forty-five and rechecks the replacement batch',async()=>{
     let reviews=0,first;
     const s=service({review:task=>{
       const data=passReviews(task.questions);
       if(++reviews===1){
         first=structuredClone(task);data.reviews[2]={...data.reviews[2],overlap:true,conflicting_database_ids:[task.databaseQuestions[0].id],reason:'只是替換數字，仍考同一細節。'};
       }else{
         assert.deepEqual(task.databaseQuestions,first.databaseQuestions);
         for(let i=0;i<5;i++)assert.notEqual(task.questions[i].question,first.questions[i].question);
       }
       return data;
     }});
     const exam=await s.hybrid.prepare(s.options);
     assert.equal(reviews,2);assert.equal(s.tasks.filter(q=>q.kind==='questions').length,2);
     assert.equal(exam.generation.review_attempts,2);assert.ok(s.progress.some(q=>q.retrying));
   });
   test('persistent quality failures or incomplete review reports cannot install a formal paper',async()=>{
     const s=service({review:task=>{
       const data=passReviews(task.questions);data.reviews[0].quality_ok=false;data.reviews[0].reason='正解或必要條件有問題。';return data;
     }});
     await assert.rejects(s.hybrid.prepare(),e=>e.status===502);
     assert.equal(s.tasks.filter(q=>q.kind==='formal-review').length,3);assert.equal(s.hybrid.busy,false);
     const broken=service({review:()=>({reviews:[]})});await assert.rejects(broken.hybrid.prepare(),e=>e.status===502);
     assert.equal(broken.hybrid.busy,false);
   });
   test('short banks reject before generation, cancellation releases the formal preparation slot',async()=>{
     const short=service({rows:approved().filter(q=>q.bank_code!==0)});
     await assert.rejects(short.hybrid.prepare(),e=>e.status===422);assert.equal(short.tasks.length,0);
     const s=service(),controller=new AbortController();controller.abort();
     await assert.rejects(s.hybrid.prepare({signal:controller.signal}),{name:'AbortError'});assert.equal(s.hybrid.busy,false);
   });
   test('existing database questions are not rejected for overlapping each other; only new questions must avoid them',async()=>{
     const rows=approved().map(row=>({...row,question:'原本題庫共用的相同題幹'}));
     const s=service({rows}),exam=await s.hybrid.prepare();
     assert.equal(exam.snapshot.questions.filter(q=>q.question==='原本題庫共用的相同題幹').length,45);validateFormalPaper(exam);
   });
   test('frozen origins and generated content are checked again before grading or insertion',async()=>{
     const s=service(),exam=await s.hybrid.prepare();
     const changed=structuredClone(exam);changed.generated_questions[0].answer='A';
     assert.throws(()=>validateFormalPaper(changed),e=>e.status===409);
     const repeated=structuredClone(exam),origin=repeated.origins.find(q=>q.kind==='bank');
     repeated.origins.find(q=>q.kind==='generated').kind='bank';
     repeated.origins.find(q=>q.kind==='bank').question_id=origin.question_id;
     assert.throws(()=>validateFormalPaper(repeated),e=>e.status===409);
   });
test('immutable fingerprints retain bank, answer, option order, explanation and difficulty',()=>{
 const q={bank:'programming',question:'測試',options:{A:'甲',B:'乙',C:'丙',D:'丁'},answer:'A',difficulty:4,explanation:'解析'};
 assert.equal(questionContentHash(q),questionContentHash(structuredClone(q)));
 for(const changed of [{...q,bank:'ai-applications'},{...q,question:'測 試'},{...q,answer:'B'},{...q,difficulty:5},{...q,explanation:'新版解析'},{...q,options:{...q.options,A:'乙',B:'甲'}}])
  assert.notEqual(questionContentHash(q),questionContentHash(changed));
});

test('previously prepared thirty-plus-twenty papers remain valid for submission', () => {
  const bankPlan = questionBanks.map((bank, index) => ({
    bank: bank.id, bank_code: bank.code, total: index < 2 ? 7 : 6,
    database: index < 6 ? 4 : 3,
    generated: (index < 2 ? 7 : 6) - (index < 6 ? 4 : 3),
  }));
  const questions = [], origins = [], generated = [];
  for (const bank of bankPlan) {
    for (const row of approved().filter(row => row.bank_code === bank.bank_code).slice(0, bank.database)) {
      questions.push({ bank: bank.bank, question: row.question, options: { A: row.A, B: row.B, C: row.C, D: row.D },
        answer: row.answer, explanation: row.explanation, difficulty: row.difficulty });
      origins.push({ kind: 'bank', bank: bank.bank, question_id: row.id });
    }
    for (let index = 0; index < bank.generated; index++) {
      const question = fixture([{ bank: bank.bank, difficulty: 4 }], generated.length).questions[0];
      origins.push({ kind: 'generated', bank: bank.bank, index: generated.length });
      generated.push(question);
      questions.push(question);
    }
  }
  const exam = { ...createPaper(questions, 50, questionBanks.map(bank => bank.id)),
    mode: 'formal', source: 'hybrid', bank_plan: bankPlan, origins, generated_questions: generated,
    generation: { reviewed: true, prompt_version: 'a'.repeat(64) } };
  assert.equal(validateFormalPaper(exam).questions.length, 50);
  exam.generated_questions.pop();
  assert.throws(() => validateFormalPaper(exam), error => error.status === 409);
});
