import test from 'node:test';
import assert from 'node:assert/strict';
import { aiBanks } from '../src/services/ai-banks.js';
import { CodexQuestionGenerator } from '../src/services/ai-questions.js';
import { HybridExamService, planFormalExam, validateFormalPaper, questionContentHash } from '../src/services/hybrid-exams.js';

   const fixture = (plan,serial) => ({questions:plan.map((item,index)=>({...item,question:'新題 '+serial+' '+index+' '+item.bank,
     options:{A:'甲',B:'乙',C:'丙',D:'丁'},answer:'B',explanation:'依題設推導，乙成立。'}))});
   const approved = () => aiBanks.flatMap(bank=>Array.from({length:10},(_,index)=>({
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
   test('formal allocation balances all eight banks and totals exactly thirty existing plus twenty new questions',()=>{
     let state=12345;const random=()=>((state=(1664525*state+1013904223)>>>0)/2**32),large=new Set();
     for(let run=0;run<1000;run++){
       const plan=planFormalExam(random);
       assert.equal(plan.length,8);assert.equal(new Set(plan.map(q=>q.bank_code)).size,8);
       assert.equal(plan.reduce((s,q)=>s+q.total,0),50);assert.equal(plan.reduce((s,q)=>s+q.database,0),30);assert.equal(plan.reduce((s,q)=>s+q.generated,0),20);
       assert.equal(plan.filter(q=>q.total===7).length,2);
       for(const q of plan){
         assert.ok([6,7].includes(q.total));assert.ok([3,4].includes(q.database));assert.ok([2,3].includes(q.generated));
         assert.equal(q.database+q.generated,q.total);assert.ok(Math.abs(q.database-q.total*0.6)<1);
         if(q.total===7)large.add(q.bank);
       }
     }
     assert.equal(large.size,8);
   });
   test('formal preparation fixes database questions first, supplies complete avoidance material and builds an immutable fifty-question paper',async()=>{
     const s=service(),exam=await s.hybrid.prepare(s.options);
     assert.equal(exam.mode,'formal');assert.equal(exam.source,'hybrid');assert.equal(exam.snapshot.difficulty_scale,9);
     assert.equal(exam.snapshot.questions.length,50);assert.equal(exam.origins.filter(q=>q.kind==='bank').length,30);
     assert.equal(exam.generated_questions.length,20);assert.equal(s.tasks.filter(q=>q.kind==='questions').length,4);
     const review=s.tasks.find(q=>q.kind==='formal-review');assert.equal(review.databaseQuestions.length,30);
     for(const task of s.tasks.filter(q=>q.kind==='questions')){
       for(const q of review.databaseQuestions)assert.ok(task.prompt.includes(q.question));
       assert.match(task.prompt,/formal|正式/);assert.equal(task.plan.length,5);
     }
     validateFormalPaper(exam);assert.equal(s.hybrid.busy,false);assert.equal(s.generator.busy,false);
   });
   test('semantic overlap repairs only affected batches, keeps the original thirty and rechecks all twenty',async()=>{
     let reviews=0,first;
     const s=service({review:task=>{
       const data=passReviews(task.questions);
       if(++reviews===1){
         first=structuredClone(task);data.reviews[7]={...data.reviews[7],overlap:true,conflicting_database_ids:[task.databaseQuestions[0].id],reason:'只是替換數字，仍考同一細節。'};
       }else{
         assert.deepEqual(task.databaseQuestions,first.databaseQuestions);
         for(let i=0;i<20;i++)assert.equal(task.questions[i].question===first.questions[i].question,!(i>=5&&i<10));
       }
       return data;
     }});
     const exam=await s.hybrid.prepare(s.options);
     assert.equal(reviews,2);assert.equal(s.tasks.filter(q=>q.kind==='questions').length,5);
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
     assert.equal(exam.snapshot.questions.filter(q=>q.question==='原本題庫共用的相同題幹').length,30);validateFormalPaper(exam);
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
