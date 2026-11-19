import {aiBanks} from './ai-banks.js';
import {floatingDifficulty} from './floating-difficulty.js';
import {recordScoreSql} from './scoring.js';
import {now,fail,pager} from '../support.js';

const DAY=86400;
const MIN_ANSWERS=20;
const RATE_DEVIATION=0.20;
const UNANSWERED_RATE=0.20;
const attentionLabels={all:'全部',pending:'待檢核',unseen:'尚無樣本',sample:'樣本不足',deviation:'答對率偏離',unanswered:'未答率偏高'};
const dateOf=seconds=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(seconds*1000));
const midnight=date=>Date.parse(date+'T00:00:00+08:00')/1000;
const median=values=>{
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
 return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
};
function statisticsWindow(period='30',time=now()){
 if(!['7','30','all'].includes(period))fail(422,'請選擇有效統計期間。');
 const endDate=dateOf(time),start=period==='all'?null:midnight(endDate)-(Number(period)-1)*DAY;
 return {key:period,label:period==='all'?'全部期間':'近 '+period+' 天',start,end:time+1,startDate:start===null?null:dateOf(start),endDate};
}
function buildTrend(records,window){
 const first=window.start??(records.length?Math.min(...records.map(r=>Number(r.submitted_at))):midnight(window.endDate));
 const startDate=dateOf(first),days=Math.floor((midnight(window.endDate)-midnight(startDate))/DAY)+1;
 const months=(Number(window.endDate.slice(0,4))-Number(startDate.slice(0,4)))*12+Number(window.endDate.slice(5,7))-Number(startDate.slice(5,7))+1;
 const unit=days<=31?'day':days<=180?'week':months<=60?'month':'year';
 const keyOf=time=>{
  const date=dateOf(time);
  if(unit==='day')return date;
  if(unit==='week')return dateOf(midnight(startDate)+Math.floor((midnight(date)-midnight(startDate))/(7*DAY))*7*DAY);
  return unit==='month'?date.slice(0,7):date.slice(0,4);
 };
 const entries=new Map();
 for(let time=midnight(startDate);time<window.end;){
  const key=keyOf(time);
  if(!entries.has(key))entries.set(key,{key,label:unit==='year'?key:unit==='month'?key.replace('-','／'):key.slice(5).replace('-','／'),attempts:0,users:new Set()});
  if(unit==='year')time=midnight(String(Number(key)+1)+'-01-01');
  else if(unit==='month'){
   const next=new Date(Date.UTC(Number(key.slice(0,4)),Number(key.slice(5,7)),1));
   time=midnight(next.toISOString().slice(0,10));
  }else time+=(unit==='week'?7:1)*DAY;
 }
 for(const record of records){
  const entry=entries.get(keyOf(Number(record.submitted_at)));
  if(entry){entry.attempts++;entry.users.add(record.user_id);}
 }
 return {unit,unitLabel:{day:'每日',week:'每週',month:'每月',year:'每年'}[unit],
  entries:[...entries.values()].map(({users,...entry})=>({...entry,participants:users.size})),maximum:Math.max(1,...[...entries.values()].map(e=>e.attempts))};
}
function analyzeStatistics(records,questions,window,{dataset='all',attention='all',page=1}={}){
 const query={period:window.key,dataset,attention};
 const banks=aiBanks.map(bank=>({...bank,total:0,approved:0,pending:0,rejected:0,appearances:0,correct:0,unanswered:0,baseSum:0,floatingSum:0}));
 const attentionCounts=Object.fromEntries(Object.keys(attentionLabels).map(key=>[key,0]));
 const positions=new Map(),candidates=[];
 for(const q of [...questions].sort((a,b)=>Number(b.id)-Number(a.id))){
  const bank=banks.find(bank=>bank.code===q.bank_code);
  bank.total++;bank[q.review_status]++;
  bank.appearances+=q.appearance_count;bank.correct+=q.correct_count;bank.unanswered+=q.unanswered_count;
  bank.baseSum+=q.difficulty;bank.floatingSum+=floatingDifficulty(q);
  const group=q.bank_code+':'+q.review_status,index=positions.get(group)??0;positions.set(group,index+1);
  if(q.review_status==='rejected')continue;
  const answered=q.appearance_count-q.unanswered_count,expected=(90-7.5*(q.difficulty-1))/100;
  const correctRate=answered?q.correct_count/answered:null,unansweredRate=q.appearance_count?q.unanswered_count/q.appearance_count:null;
  const reasons=[];
  if(q.review_status==='pending')reasons.push({key:'pending',label:'待檢核',priority:0});
  if(answered>=MIN_ANSWERS&&Math.abs(correctRate-expected)+1e-12>=RATE_DEVIATION)reasons.push({key:'deviation',label:'答對率偏離預期',priority:1});
  if(q.appearance_count>=MIN_ANSWERS&&unansweredRate>=UNANSWERED_RATE)reasons.push({key:'unanswered',label:'未答率偏高',priority:1});
  if(q.appearance_count===0)reasons.push({key:'unseen',label:'尚無作答樣本',priority:2});
  else if(answered<MIN_ANSWERS)reasons.push({key:'sample',label:'有效樣本不足',priority:3});
  if(!reasons.length)continue;
  attentionCounts.all++;for(const reason of reasons)attentionCounts[reason.key]++;
  if(attention!=='all'&&!reasons.some(reason=>reason.key===attention))continue;
  candidates.push({id:Number(q.id),bank:bank.name,question:q.question,difficulty:q.difficulty,floatingDifficulty:floatingDifficulty(q),
   appearances:q.appearance_count,answered,correct:q.correct_count,unanswered:q.unanswered_count,correctRate,unansweredRate,expected,reasons,
   priority:Math.min(...reasons.map(reason=>reason.priority)),deviation:correctRate===null?0:Math.abs(correctRate-expected),
   url:'/questions?'+new URLSearchParams({bank:q.bank_code,status:q.review_status,page:Math.floor(index/10)+1})+'#question-'+q.id});
 }
 candidates.sort((a,b)=>a.priority-b.priority||(a.priority===1?b.deviation-a.deviation:a.answered-b.answered)||b.id-a.id);
 const pagination=pager(candidates.length,10,page,'/statistics',query);
 const medianCents=median(records.map(r=>Math.round(Number(r.score)*100)));
 const passed=records.filter(r=>Number(r.score)>=60&&Number(r.elapsed_seconds)<=5400).length;
 const distribution=Array.from({length:10},(_,i)=>({label:i===9?'90～100':i*10+'～未滿 '+(i+1)*10,count:0}));
 for(const record of records)distribution[Math.max(0,Math.min(9,Math.floor(Number(record.score)/10)))].count++;
 return {window,dataset,attention,
  summary:{participants:new Set(records.map(r=>r.user_id)).size,attempts:records.length,passed,passRate:records.length?passed/records.length*100:null,
   medianScore:medianCents===null?null:Math.round(medianCents)/100,medianSeconds:median(records.map(r=>Number(r.elapsed_seconds))),
   available:banks.reduce((n,bank)=>n+bank.approved,0),questionTotal:questions.length,demoRecords:records.filter(r=>Number(r.is_demo)===1).length},
  trend:buildTrend(records,window),distribution,
  banks:banks.map(({baseSum,floatingSum,...bank})=>({...bank,answered:bank.appearances-bank.unanswered,
   correctRate:bank.appearances-bank.unanswered?bank.correct/(bank.appearances-bank.unanswered)*100:null,
   unansweredRate:bank.appearances?bank.unanswered/bank.appearances*100:null,
   baseDifficulty:bank.total?baseSum/bank.total:null,floatingDifficulty:bank.total?floatingSum/bank.total:null})),
  attentionCounts,candidates:candidates.slice((pagination.page-1)*10,pagination.page*10),pager:pagination,
  attentionFilters:Object.entries(attentionLabels).map(([key,label])=>({key,label,count:attentionCounts[key],
   url:'/statistics?'+new URLSearchParams({...query,attention:key})+'#attention'})),
  thresholds:{minimumAnswers:MIN_ANSWERS,deviation:RATE_DEVIATION*100,unansweredRate:UNANSWERED_RATE*100}};
}
class StatisticsService{
 constructor(pool,clock=now){this.pool=pool;this.clock=clock;}
 async report({period='30',dataset='all',attention='all',page=1}={}){
  const window=statisticsWindow(period,this.clock());
  if(!['all','exclude-demo'].includes(dataset)||!Object.hasOwn(attentionLabels,attention))fail(422,'統計篩選條件不正確。');
  const conditions=['e.submitted_at<?'],values=[window.end];
  if(window.start!==null){conditions.push('e.submitted_at>=?');values.push(window.start);}
  if(dataset==='exclude-demo')conditions.push('e.is_demo=0');
  const [[records],[questions]]=await Promise.all([
   this.pool.execute('SELECT e.id,e.user_id,e.submitted_at,e.elapsed_seconds,e.is_demo,'+recordScoreSql('e')+
    ' AS score FROM exam_records e WHERE '+conditions.join(' AND ')+' ORDER BY e.submitted_at,e.id',values),
   this.pool.query('SELECT id,bank_code,question,difficulty,review_status,appearance_count,correct_count,unanswered_count FROM questions ORDER BY id DESC')
  ]);
  return analyzeStatistics(records,questions,window,{dataset,attention,page});
 }
}

export {StatisticsService,statisticsWindow,analyzeStatistics};
