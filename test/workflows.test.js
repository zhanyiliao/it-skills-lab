import {describe,it,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import {config} from '../src/config.js';
import {setupDatabase} from '../src/setup.js';
import {createApp} from '../src/app.js';
import {createPool,one} from '../src/db.js';
import {now} from '../src/support.js';
import {questionBanks} from '../src/services/question-banks.js';
import {CodexQuestionGenerator} from '../src/services/ai-questions.js';
import {QuestionRepository} from '../src/services/questions.js';
import {RecordRepository} from '../src/services/records.js';
import {readAnswerReferences} from '../src/services/answer-records.js';
import {questionContentHash} from '../src/services/question-content.js';
import {weightedScore} from '../src/services/scoring.js';
import {StatisticsService} from '../src/services/statistics.js';
import {questionTextHtml} from '../src/services/exam-paper.js';

const database='it_skills_lab_test_'+randomBytes(6).toString('hex');
const dbConfig={...config.db,database};
const password='NodeTest2026!',decode=v=>typeof v==='string'?JSON.parse(v):v;
const csrf=html=>html.match(/name="_token" value="([^"]+)"/)?.[1]??html.match(/name="csrf-token" content="([^"]+)"/)?.[1];
const firstCorrectScore=exam=>Math.round(exam.snapshot.questions[0].difficulty*10000/exam.snapshot.questions.reduce((sum,q)=>sum+q.difficulty,0))/100;
let pool,app,server,student,teacher,admin,studentId,teacherId,adminId,recordId,serial=0;
let run=async(signal,progress,task)=>{
 progress();
 if(task.kind==='formal-review')return JSON.stringify({reviews:task.questions.map((q,index)=>({
  index,quality_ok:true,overlap:false,conflicting_database_ids:[],conflicting_generated_indices:[],reason:'測試內容已檢查。'
 }))});
 return JSON.stringify({questions:task.plan.map((p,index)=>({...p,question:'測試新題-'+(++serial)+'-'+index+'\nif(x < 3) x++;\n<script>bad()</script>',
  options:{A:'甲',B:'乙',C:'丙',D:'丁'},answer:'B',explanation:'測試解析 <script>bad()</script>'}))});
};
async function token(agent,url='/account'){return csrf((await agent.get(url).redirects(1).expect(200)).text);}
async function login(name){
 const agent=request.agent(server),page=await agent.get('/login').expect(200);
 const signedIn=await agent.post('/login').type('form').send({_token:csrf(page.text),username:name,password}).expect(302);
 assert.match(signedIn.headers.location,/^\/account\/[0-9]+$/);
 return agent;
}
async function activeRow(){return one(pool,'SELECT * FROM node_active_exams WHERE user_id=?',[studentId]);}
async function paper(){return student.get('/exams/current').expect(200);}
function fields(html,sequence=1,extra={}){
 return {_token:csrf(html),_exam:html.match(/name="_exam" value="([^"]+)"/)[1],_page:html.match(/name="_page" value="([^"]+)"/)[1],
  _sequence:sequence,visibility:'visible',...extra};
}
async function startPractice(amount=10,banks=questionBanks.map(b=>b.id)){
 await student.post('/exams/practice/start').type('form').send({_token:await token(student),amount,'banks[]':banks}).expect(302);
 return paper();
}
async function startFormal(){
 await student.post('/exams/formal/start').set('Accept','application/json').type('form').send({_token:await token(student)}).expect(200);
 return paper();
}
async function questionStats(){return one(pool,'SELECT SUM(appearance_count) AS appearances,SUM(correct_count) AS correct,SUM(unanswered_count) AS unanswered FROM questions');}
async function count(table){return Number((await one(pool,'SELECT COUNT(*) AS total FROM '+table)).total);}
function assertReferences(details,amount){
 const data=readAnswerReferences(details);assert.equal(data.questions.length,amount);
 assert.deepEqual(Object.keys(data).sort(),['questions','version']);
 assert.ok(data.questions.every(q=>Object.keys(q).sort().join(',')==='question_id,selected_answer'));
 return data;
}
describe('current website and reference-history workflows',()=>{
 before(async()=>{
  await setupDatabase({dbConfig});pool=createPool(dbConfig);
  const hash=await bcrypt.hash(password,4);
  for(const [name,role]of[['teststudent',0],['testteacher',1],['testadmin',2]]){
   const [r]=await pool.execute('INSERT INTO user(username,password,role,reg_time) VALUES (?,?,?,?)',[name,hash,role,now()]);
   if(role===0)studentId=Number(r.insertId);if(role===1)teacherId=Number(r.insertId);if(role===2)adminId=Number(r.insertId);
  }
  app=createApp({pool,secret:'integration-test-session-secret-32-chars',disableRateLimits:true,questionGenerator:new CodexQuestionGenerator((...args)=>run(...args))});
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});
  student=await login('teststudent');teacher=await login('testteacher');admin=await login('testadmin');
 });
 after(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool?.end();
  const db=await mysql.createConnection({...config.db,database:undefined});
  if(!/^it_skills_lab_test_[a-f0-9]{12}$/.test(database))throw Error('Unsafe test cleanup');
  await db.query('DROP DATABASE IF EXISTS '+database);await db.end();
 });
 it('fresh installs contain 400 questions and no exam history',async()=>{
  assert.equal(await count('questions'),400);assert.equal(await count('exam_records'),0);
  await setupDatabase({dbConfig});assert.equal(await count('questions'),400);
 });
 it('public pages and protected member views render',async()=>{
  for(const url of ['/','/about','/leaderboard','/account/'+studentId]){
   await request(app).get(url).expect(200);
  }
  await request(app).get('/missing').expect(404);
  for(const url of ['/account','/exams','/results/latest','/questions','/members','/statistics'])await request(app).get(url).expect(302);
  for(const url of ['/account/'+studentId,'/exams','/results/latest','/settings/profile'])await student.get(url).expect(200);
  await admin.get('/members').expect(200);await admin.get('/statistics').expect(200);
 });


 it('canonical profiles combine public scores with owner-only account actions',async()=>{
  const own=await student.get('/account/'+studentId).expect(200);
  assert.match(own.text,/class="feature-grid account-actions"/);
  assert.match(own.text,/帳號設定/);
  for(const label of ['主要導覽','行動版導覽']){
   const menu=own.text.match(new RegExp('aria-label="'+label+'"[^>]*>([\\s\\S]*?)<\/nav>'))?.[1];
   assert.ok(menu);assert.ok(!menu.includes('/results/latest'));
  }
  const accountMenu=own.text.match(/aria-label="帳號操作"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(accountMenu?.includes('href="/results/latest"'));
  const actions=own.text.slice(own.text.indexOf('class="feature-grid account-actions"'));
  assert.ok(actions.includes('href="/results/latest"'));assert.ok(!actions.includes('href="/exams"'));
  assert.doesNotMatch(own.text,/管理工作台|我的帳號|前往個人主頁/);
  assert.match(own.headers['cache-control'],/no-store/);
  for(const viewer of [request(app),teacher]){
   const page=await viewer.get('/account/'+studentId).expect(200);
   assert.match(page.text,/teststudent/);
   assert.doesNotMatch(page.text,/class="feature-grid account-actions"|管理工作台/);
  }
  const teacherOwn=await teacher.get('/account/'+teacherId).expect(200);
  assert.match(teacherOwn.text,/管理工作台/);
  assert.doesNotMatch(teacherOwn.text,/href="\/members"/);
  const adminOwn=await admin.get('/account/'+adminId).expect(200);
  assert.match(adminOwn.text,/管理工作台/);
  assert.match(adminOwn.text,/href="\/members"/);
  const foreignAdmin=await admin.get('/account/'+teacherId).expect(200);
  assert.doesNotMatch(foreignAdmin.text,/class="feature-grid account-actions"|管理工作台/);
  await request(app).get('/account/0').expect(404);
  await request(app).get('/account/999999').expect(404);
 });
 it('account shortcuts and old profile URLs point to the single canonical profile',async()=>{
  await student.get('/account').expect(302).expect('Location','/account/'+studentId);
  await request(app).get('/members/'+studentId).expect(301).expect('Location','/account/'+studentId);
  await student.get('/login').expect(302).expect('Location','/account/'+studentId);
  for(const url of ['/leaderboard','/leaderboard?type=high_score']){
   const page=await student.get(url).expect(200);
   assert.match(page.text,/href="\/account\/[0-9]+"/);
   assert.doesNotMatch(page.text,/href="\/members\/[0-9]+"/);
  }
  const members=await admin.get('/members').expect(200);
  assert.match(members.text,/href="\/account\/[0-9]+"/);
  assert.doesNotMatch(members.text,/href="\/members\/[0-9]+"/);
 });
 it('question management requires teacher role and validates CSRF and all eight banks',async()=>{
  await student.get('/questions').expect(403);
  await teacher.post('/questions').type('form').send({}).expect(419);
  for(const bank of questionBanks){
   const page=await teacher.get('/questions?bank='+bank.code).expect(200);
   assert.match(page.text,new RegExp(bank.name));assert.match(page.text,/name="difficulty"/);
   assert.match(page.text,/name="explanation"/);
  }
  await teacher.get('/questions?bank=8').expect(404);
  await teacher.get('/questions?status=other').expect(422);
  await teacher.post('/questions').type('form').send({_token:await token(teacher),bank_code:0,difficulty:10}).expect(422);
 });
 it('practice keeps balanced database-only papers on refresh and stores only IDs and selections',async()=>{
  const statsBefore=await questionStats();
  const before=await count('exam_records'),page=await startPractice(),row=await activeRow(),exam=decode(row.exam);
  assert.equal(exam.source,'bank');assert.equal(exam.snapshot.questions.length,10);
  for(const bank of questionBanks)assert.ok(exam.snapshot.questions.some(q=>q.bank_name===bank.name));
  assert.doesNotMatch(page.text,/★|☆|difficulty-rating|correct_answer|selected_answer/);
  const answer=exam.snapshot.questions[0].correct_answer;
  await student.post('/exams/save').type('form').send(fields(page.text,1,{Q1:answer})).expect(200);
  const refreshed=await paper();assert.equal(decode((await activeRow()).exam).nonce,exam.nonce);
  assert.equal(decode((await activeRow()).answers).Q1,answer);
  await student.post('/exams/submit').type('form').send(fields(refreshed.text,2,{Q1:answer})).expect(302).expect('Location','/results/review?mode=practice');
  const saved=await activeRow(),result=decode(saved.result);assert.equal(result.score,firstCorrectScore(exam));
  assertReferences(result.details,10);assert.equal(decode(saved.exam).snapshot,undefined);assert.equal(decode(saved.exam).question_ids,undefined);
  assert.deepEqual(decode(saved.answers),{});assert.equal(await count('exam_records'),before);
  assert.match((await student.get('/results/latest').expect(200)).text,/回到.*檢討/);
  const review=await student.get('/results/review?mode=practice').expect(200);assert.match(review.text,/class="difficulty-rating"/);assert.doesNotMatch(review.text.match(/class="difficulty-rating"[\s\S]*?<\/div>/)?.[0]??'',/初始|初出/);
  assert.equal(review.headers['cache-control'],'no-store');
  assert.deepEqual(await questionStats(),statsBefore);
 });
 it('new management preserves reviewed question versions and selected-letter meanings',async()=>{
  const completed=decode((await activeRow()).result),ref=completed.details.questions[0];
  const original=await one(pool,'SELECT * FROM questions WHERE id=?',[ref.question_id]);
  const before=await student.get('/results/review?mode=practice').expect(200);
  const body={...original,_token:await token(teacher),_method:'PUT',question:'版本更新：<script>bad()</script>\nconst y = 1;'};
  await teacher.post('/questions/'+original.id).type('form').send(body).expect(302);
  const next=await one(pool,'SELECT * FROM questions WHERE content_hash=?',[questionContentHash(body)]);
  assert.notEqual(next.id,original.id);assert.equal(next.review_status,'approved');
  assert.equal((await one(pool,'SELECT * FROM questions WHERE id=?',[original.id])).question,original.question);
  assert.equal((await one(pool,'SELECT review_status FROM questions WHERE id=?',[original.id])).review_status,'rejected');
  const after=await student.get('/results/review?mode=practice').expect(200);
  assert.match(after.text,new RegExp('題庫來源'));assert.ok(before.text.includes('解析'));
  assert.doesNotMatch(after.text,/版本更新/);
  const total=await count('questions');
  await teacher.post('/questions/'+next.id).type('form').send({...body,_token:await token(teacher),review_status:'pending'}).expect(302);
  assert.equal(await count('questions'),total);
  await teacher.post('/questions/'+next.id).type('form').send({_token:await token(teacher),_method:'DELETE'}).expect(302);
  assert.equal((await one(pool,'SELECT review_status FROM questions WHERE id=?',[next.id])).review_status,'rejected');
  assert.equal(await count('questions'),total);
  const rendered=await teacher.get('/questions?bank='+original.bank_code+'&status=rejected').expect(200);
  assert.match(rendered.text,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.doesNotMatch(rendered.text,/<script>bad\(\)<\/script>/);
 });
 it('practice rejects insufficient stock and never silently supplies an unselected subject',async()=>{
  await student.post('/exams/practice/start').type('form').send({_token:await token(student),amount:5,'banks[]':['programming']}).expect(422);
  const repository=new QuestionRepository(pool);
  await pool.query("UPDATE questions SET review_status='pending' WHERE bank_code=7");
  try{await assert.rejects(repository.start(50,['ai-applications']),e=>e.status===422);}
  finally{await pool.query("UPDATE questions SET review_status='approved' WHERE bank_code=7");}
 });
 it('hybrid formal submission admits five questions atomically and stores fifty valid references',async()=>{
  const page=await startFormal(),exam=decode((await activeRow()).exam);
  assert.equal(exam.mode,'formal');assert.equal(exam.origins.filter(q=>q.kind==='bank').length,45);
  const input=fields(page.text,1,Object.fromEntries(exam.snapshot.questions.map((q,i)=>['Q'+(i+1),q.correct_answer])));
  const before=await count('questions'),beforeRecords=await count('exam_records');
  await pool.query("CREATE TRIGGER reference_rollback BEFORE INSERT ON exam_records FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced rollback'");
  const originalError=console.error;console.error=()=>{};
  try{await student.post('/exams/submit').type('form').send(input).expect(500);}
  finally{console.error=originalError;await pool.query('DROP TRIGGER reference_rollback');}
  assert.equal(await count('questions'),before);assert.equal(await count('exam_records'),beforeRecords);
  assert.equal((await activeRow()).result,null);
  assert.equal((await one(pool,'SELECT COUNT(*) AS total FROM node_exam_submissions WHERE nonce=?',[exam.nonce])).total,0);
  const submitted=await student.post('/exams/submit').type('form').send(input).expect(302);
  recordId=Number(submitted.headers.location.split('=')[1]);
  const record=await one(pool,'SELECT * FROM exam_records WHERE id=?',[recordId]),details=assertReferences(record.details,50);
  assert.equal(Number(record.score),100);assert.equal(await count('questions'),before+5);
  const ids=details.questions.map(q=>q.question_id);
  const rows=(await pool.query('SELECT * FROM questions WHERE id IN (?)',[ids]))[0];assert.equal(rows.length,50);
  assert.equal(rows.filter(q=>q.generation_batch==='formal-'+exam.nonce).length,5);
  for(const [index,ref]of details.questions.entries()){
   const q=rows.find(q=>q.id===ref.question_id);assert.equal(ref.selected_answer,q.answer);
   assert.equal(questionTextHtml(q.question),exam.snapshot.questions[index].question);
  }
  const result=decode((await activeRow()).result);assert.deepEqual(result.details,details);
  assert.equal(decode((await activeRow()).exam).generated_questions,undefined);
  const scores=await new RecordRepository(pool).scores(studentId);assert.equal(scores.high_score,100);assert.equal(scores.last_score,100);
  const latest=await student.get('/results/latest?record='+recordId).expect(200);
  assert.match(latest.text,/八科能力雷達/);assert.match(latest.text,/本次測驗合格/);
  assert.equal((latest.text.match(/class="radar-axis"/g)||[]).length,8);
  await student.get('/results/review?record='+recordId).expect(200);
  await teacher.get('/results/review?record='+recordId).expect(404);
  await student.get('/leaderboard?type=high_score').expect(200);
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
  const midnight=Math.floor(Date.parse(today+'T00:00:00+08:00')/1000),repository=new QuestionRepository(pool);
  const todayIds=new Set((await repository.approvedIds(midnight)).map(q=>q.id));
  const tomorrowIds=new Set((await repository.approvedIds(midnight+86400)).map(q=>q.id));
  const fresh=rows.filter(q=>q.generation_batch==='formal-'+exam.nonce);
  assert.ok(fresh.every(q=>!todayIds.has(q.id)&&tomorrowIds.has(q.id)));
  await student.post('/exams/submit').type('form').send(input).expect(409);
  assert.equal(await count('exam_records'),beforeRecords+1);assert.equal(await count('questions'),before+5);
  assert.equal(Number((await one(pool,'SELECT SUM(appearance_count) AS total FROM questions')).total),0);
 });
 it('formal reference reviews remain stable after source questions are revised or disabled',async()=>{
  const record=await one(pool,'SELECT * FROM exam_records WHERE id=?',[recordId]),refs=decode(record.details);
  const id=refs.questions[0].question_id,repository=new QuestionRepository(pool),original=await repository.find(id);
  const before=await repository.reviewRows(refs);
  await repository.update(id,{...original,question:'新版題目，不應出現在既有檢討'});
  await repository.disable(id);
  assert.deepEqual(await repository.reviewRows(refs),before);
  const latest=await student.get('/results/latest?record='+recordId).expect(200);
  assert.match(latest.text,/本次測驗合格/);
  assert.equal(Number((await one(pool,'SELECT score FROM exam_records WHERE id=?',[recordId])).score),100);
 });
 it('saves hidden tabs, rejects stale page leases and auto-submits only after departure grace',async()=>{
  const page=await startPractice(),exam=decode((await activeRow()).exam),clock=app.locals.activeExams.clock;
  const time=now();app.locals.activeExams.clock=()=>time;
  try{
   await student.post('/exams/save').type('form').send(fields(page.text,1,{visibility:'hidden',Q1:exam.snapshot.questions[0].correct_answer})).expect(200);
   app.locals.activeExams.clock=()=>time+121;await app.locals.activeExams.sweep();
   assert.equal((await activeRow()).result,null);
   const refreshed=await paper();
   await student.post('/exams/save').type('form').send(fields(page.text,2)).expect(409);
   await student.post('/exams/depart').type('form').send(fields(refreshed.text,2,{Q1:exam.snapshot.questions[0].correct_answer})).expect(200);
   app.locals.activeExams.clock=()=>time+150;await app.locals.activeExams.sweep();assert.equal((await activeRow()).result,null);
   app.locals.activeExams.clock=()=>time+152;await app.locals.activeExams.sweep();
   const result=decode((await activeRow()).result);assert.equal(result.reason,'leave');assert.equal(result.score,firstCorrectScore(exam));assertReferences(result.details,10);
  }finally{app.locals.activeExams.clock=clock;}
 });
 it('replacing a formal exam grades its current answers once before opening database practice',async()=>{
  const page=await startFormal(),exam=decode((await activeRow()).exam),before=await count('exam_records');
  await student.post('/exams/save').type('form').send(fields(page.text,1,{Q1:exam.snapshot.questions[0].correct_answer})).expect(200);
  await startPractice();assert.equal(await count('exam_records'),before+1);
  const record=await new RecordRepository(pool).find(studentId);assert.equal(record.score,firstCorrectScore(exam));assertReferences(record.details,50);
  assert.equal(decode((await activeRow()).exam).source,'bank');
 });
 it('logout submits pending practice and expires private review access without adding formal records',async()=>{
  const before=await count('exam_records');
  await student.post('/logout').type('form').send({_token:await token(student)}).expect(302);
  assert.equal(decode((await activeRow()).result).reason,'logout');
  assert.equal(await count('exam_records'),before);
  await student.get('/results/review?mode=practice').expect(302);
  student=await login('teststudent');
  await student.get('/results/review?mode=practice').expect(302).expect('Location','/exams');
 });
 it('daily question remains database-backed, signed and outside score history',async()=>{
  const home=await student.get('/').expect(200),before=await count('exam_records');
  const value=name=>home.text.match(new RegExp('name="'+name+'" value="([^"]+)"'))?.[1];
  const id=Number(value('question_id')),q=await one(pool,'SELECT * FROM questions WHERE id=?',[id]);
  assert.match(home.text,/class="difficulty-rating"/);
  assert.equal((home.text.match(/class="difficulty-star"/g)||[]).length,10);
  const response=await student.post('/daily-question/answer').set('Accept','application/json').type('form').send({
   _token:csrf(home.text),question_id:id,date:value('date'),signature:value('signature'),choice:q.answer
  }).expect(200);assert.equal(response.body.answer,q.answer);assert.ok(response.body.html.includes('解析'));
  await student.post('/daily-question/answer').set('Accept','application/json').type('form').send({
   _token:csrf(home.text),question_id:id+1,date:value('date'),signature:value('signature'),choice:q.answer
  }).expect(409);
  assert.equal(await count('exam_records'),before);
 });


 it('management creates plain-text questions with automatic IDs and ignores client-supplied statistics',async()=>{
  const data={bank_code:0,difficulty:1,question:'新增測試 <script>bad()</script>',A:'一',B:'二',C:'三',D:'四',
   answer:'A',explanation:'解析',review_status:'pending',appearance_count:100,correct_count:99};
  await teacher.post('/questions').type('form').send({...data,_token:await token(teacher)}).expect(302);
  const q=await one(pool,'SELECT * FROM questions WHERE content_hash=?',[questionContentHash(data)]);
  assert.ok(q.id>0);assert.equal(q.appearance_count,0);assert.equal(q.correct_count,0);
  assert.equal(q.question,data.question);assert.equal(q.bank_code,0);
  await teacher.post('/questions').type('form').send({...data,_token:await token(teacher)}).expect(409);
 });
 it('formal preparation requires login and CSRF and streams review stages before installing a paper',async()=>{
  const guest=request.agent(server),home=await guest.get('/').expect(200);
  await guest.post('/exams/formal/start').set('Accept','application/json').type('form').send({_token:csrf(home.text)}).expect(401);
  await student.post('/exams/formal/start').type('form').send({}).expect(419);
  const response=await student.post('/exams/formal/start').set('Accept','application/x-ndjson').type('form').send({_token:await token(student)}).expect(200);
  const events=response.text.trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(events.some(e=>e.type==='stage'&&e.stage==='validating'));assert.equal(events.at(-1).type,'result');
  assert.equal(events.at(-1).destination,'/exams/current');
  const page=await paper();await student.post('/exams/submit').type('form').send(fields(page.text)).expect(302);
 });
 it('late AI generation cannot overwrite another tab or install a paper after logout',async()=>{
  const originalRun=run;
  for(const action of ['replace','logout']){
   let release,entered;
   const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
   let held=false;
   run=async(...args)=>{
    if(!held&&args[2].kind!=='formal-review'){held=true;entered();await gate;}
    return originalRun(...args);
   };
   const pending=student.post('/exams/formal/start').set('Accept','application/json').type('form').send({_token:await token(student)}).then(response=>response);
   await started;
   let nonce;
   if(action==='replace'){await startPractice();nonce=(await activeRow()).nonce;}
   else await student.post('/logout').type('form').send({_token:await token(student)}).expect(302);
   release();
   const response=await pending;
   assert.equal(response.status,action==='replace'?409:401);
   if(action==='replace')assert.equal((await activeRow()).nonce,nonce);
   else student=await login('teststudent');
   run=originalRun;
  }
 });

 it('history, recent results and last-score rankings recalculate weights rather than trust the stored score',async()=>{
  const rows=(await pool.query("SELECT * FROM questions WHERE review_status='approved' ORDER BY id LIMIT 50"))[0];
  const refs={version:2,questions:rows.map((q,index)=>({question_id:Number(q.id),selected_answer:index%3===0?q.answer:null}))};
  const expected=weightedScore(rows.map((q,index)=>({difficulty:q.difficulty,correct:index%3===0})));
  await pool.execute('UPDATE user SET high_score=76.54 WHERE identity=?',[teacherId]);
  const [inserted]=await pool.execute('INSERT INTO exam_records(user_id,started_at,submitted_at,score,elapsed_seconds,details) VALUES (?,?,?,?,?,?)',
   [teacherId,now()-100,now(),2,100,JSON.stringify(refs)]);
  const repository=new RecordRepository(pool),id=Number(inserted.insertId);
  assert.equal((await repository.find(teacherId,id)).score,expected);
  assert.equal((await repository.recent(teacherId))[0].score,expected);
  assert.equal((await repository.scores(teacherId)).last_score,expected);
  assert.equal((await repository.scores(teacherId)).high_score,76.54);
  const page=await teacher.get('/results/latest?record='+id).expect(200);
  assert.ok(page.text.includes(expected.toFixed(2)));assert.match(page.text,/加權分數/);
  refs.questions.forEach((ref,index)=>ref.selected_answer=rows[index].answer);
  await pool.execute('UPDATE exam_records SET details=? WHERE id=?',[JSON.stringify(refs),id]);
  assert.equal((await repository.find(teacherId,id)).score,100);
  assert.equal((await repository.scores(teacherId)).last_score,100);
  assert.equal((await repository.scores(teacherId)).high_score,76.54);
  assert.equal(Number((await one(pool,'SELECT score FROM exam_records WHERE id=?',[id])).score),2);
  assert.match((await teacher.get('/results/review?record='+id).expect(200)).text,/100\.00 分/);
 });

 it('password changes preserve login for the owner and invalidate other sessions',async()=>{
  const other=await login('testadmin');
  await admin.post('/settings/password').type('form').send({_token:await token(admin),
   current_password:password,password:'UpdatedTest2026!',password_confirmation:'UpdatedTest2026!'}).expect(302);
  const owner=await admin.get('/account/'+adminId).expect(200);assert.match(owner.text,/class="feature-grid account-actions"/);
  await other.get('/account').expect(302);
 });
 it('database setup preserves existing users, questions, highest scores and complete histories',async()=>{
  const capture=async()=>Promise.all(['user','questions','exam_records'].map(async table=>
   (await pool.query('SELECT * FROM '+table+' ORDER BY '+(table==='user'?'identity':'id')))[0]));
  const before=await capture();
  await setupDatabase({dbConfig});
  assert.deepEqual(await capture(),before);
 });

 it('statistics filters existing data, excludes future records and never writes business data',async()=>{
  await student.get('/statistics').expect(403);await teacher.get('/statistics').expect(403);
  for(const query of ['period=99','dataset=real','attention=unknown'])await admin.get('/statistics?'+query).expect(422);
  const service=new StatisticsService(pool),beforeSeven=await service.report({period:'7'}),beforeAll=await service.report({period:'all'}),
   beforeExcluded=await service.report({period:'7',dataset:'exclude-demo'});
  const rows=(await pool.query("SELECT * FROM questions WHERE review_status='approved' ORDER BY id LIMIT 50"))[0];
  const refs={version:2,questions:rows.map(q=>({question_id:Number(q.id),selected_answer:q.answer}))},insertedIds=[];
  const original=rows[0];
  try{
   for(const [submitted,elapsed,demo]of [[now(),4200,0],[now()-8*86400,100,0],[now()+86400,100,0],[now(),5401,1]]){
    const [r]=await pool.execute('INSERT INTO exam_records(user_id,started_at,submitted_at,score,elapsed_seconds,details,is_demo) VALUES (?,?,?,?,?,?,?)',
     [teacherId,submitted-elapsed,submitted,0,elapsed,JSON.stringify(refs),demo]);insertedIds.push(Number(r.insertId));
   }
   await pool.execute('UPDATE questions SET appearance_count=20,correct_count=0,unanswered_count=0 WHERE id=?',[original.id]);
   const seven=await service.report({period:'7'}),all=await service.report({period:'all'}),excluded=await service.report({period:'7',dataset:'exclude-demo'});
   assert.equal(seven.summary.attempts,beforeSeven.summary.attempts+2);
   assert.equal(seven.summary.passed,beforeSeven.summary.passed+1);
   assert.equal(all.summary.attempts,beforeAll.summary.attempts+3);
   assert.equal(excluded.summary.attempts,beforeExcluded.summary.attempts+1);
   const capture=async()=>Promise.all(['user','questions','exam_records'].map(async table=>
    (await pool.query('SELECT * FROM '+table+' ORDER BY '+(table==='user'?'identity':'id')))[0]));
   const snapshot=await capture();
   const page=await admin.get('/statistics?period=7&dataset=exclude-demo&attention=deviation').expect(200);
   assert.match(page.text,/使用與題庫概況|使用趨勢|八個題庫概況|需要留意的題目/);
   assert.match(page.text,/不更新成績、題目或統計次數/);assert.match(page.headers['cache-control'],/no-store/);
   assert.doesNotMatch(page.text,/<script>bad\(\)<\/script>/);
   const flagged=await service.report({attention:'deviation'}),candidate=flagged.candidates.find(q=>q.id===original.id);
   assert.ok(candidate);const management=await admin.get(candidate.url.split('#')[0]).expect(200);
   assert.ok(management.text.includes('id="question-'+original.id+'"'));
   assert.deepEqual(await capture(),snapshot);
   const empty=await admin.get('/statistics?period=7&attention=unanswered&page=999').expect(200);
   assert.match(empty.text,/目前沒有符合這個篩選條件的題目/);
  }finally{
   await pool.execute('UPDATE questions SET appearance_count=?,correct_count=?,unanswered_count=? WHERE id=?',
    [original.appearance_count,original.correct_count,original.unanswered_count,original.id]);
   if(insertedIds.length)await pool.query('DELETE FROM exam_records WHERE id IN (?)',[insertedIds]);
  }
 });

});
