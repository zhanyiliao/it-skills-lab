import test from 'node:test';
import assert from 'node:assert/strict';
import {StatisticsService,statisticsWindow,analyzeStatistics} from '../src/services/statistics.js';

const time=Date.parse('2026-10-29T16:30:00Z')/1000;
const question=(id,values={})=>({id,bank_code:0,question:'題目 '+id,difficulty:5,review_status:'approved',appearance_count:0,correct_count:0,unanswered_count:0,...values});
const record=(id,values={})=>({id,user_id:id,score:100,elapsed_seconds:100,submitted_at:time,is_demo:0,...values});

test('statistics windows use Taipei calendar days and include today without future records',()=>{
 const seven=statisticsWindow('7',time),thirty=statisticsWindow('30',time),all=statisticsWindow('all',time);
 assert.equal(seven.start,Date.parse('2026-10-24T00:00:00+08:00')/1000);
 assert.equal(thirty.startDate,'2026-10-01');assert.equal(seven.endDate,'2026-10-30');
 assert.equal(seven.end,time+1);assert.equal(all.start,null);
 assert.throws(()=>statisticsWindow('365',time),e=>e.status===422);
});
test('record summaries count attempts and unique people separately and honor the ninety-minute boundary',()=>{
 const records=[record(1,{score:60,elapsed_seconds:5400}),record(2,{user_id:1,score:80,elapsed_seconds:5401,is_demo:1}),
  record(3,{user_id:2,score:40,elapsed_seconds:100}),record(4,{user_id:3,score:100,elapsed_seconds:0})];
 const result=analyzeStatistics(records,[question(1)],statisticsWindow('7',time));
 assert.equal(result.summary.attempts,4);assert.equal(result.summary.participants,3);
 assert.equal(result.summary.passed,2);assert.equal(result.summary.passRate,50);
 assert.equal(result.summary.medianScore,70);assert.equal(result.summary.medianSeconds,2750);
 assert.equal(result.summary.demoRecords,1);assert.equal(result.distribution.reduce((n,b)=>n+b.count,0),4);
 assert.equal(result.trend.entries.at(-1).participants,3);
 const rounded=analyzeStatistics([record(1,{score:68.44}),record(2,{score:68.45})],[],statisticsWindow('7',time));
 assert.equal(rounded.summary.medianScore,68.45);
});
test('small samples are distinguished from quality signals and disabled questions stay out of the review queue',()=>{
 const rows=[question(12,{appearance_count:20,correct_count:4}),question(11,{appearance_count:5,unanswered_count:1}),
  question(10,{appearance_count:20,correct_count:10,unanswered_count:5}),question(9),question(8,{review_status:'pending'}),
  question(7,{review_status:'rejected',appearance_count:100}),question(6,{appearance_count:20,correct_count:12})];
 const result=analyzeStatistics([],rows,statisticsWindow('30',time));
 assert.deepEqual(result.attentionCounts,{all:5,pending:1,unseen:2,sample:2,deviation:1,unanswered:1});
 assert.equal(result.candidates[0].id,8);assert.ok(!result.candidates.some(q=>q.id===7||q.id===6));
 assert.deepEqual(result.candidates.find(q=>q.id===11).reasons.map(r=>r.key),['sample']);
 assert.equal(result.banks[0].approved,5);assert.equal(result.banks[0].pending,1);assert.equal(result.banks[0].rejected,1);
 assert.equal(result.banks.length,8);assert.equal(result.banks[0].answered,159);
 assert.equal(result.summary.passRate,null);assert.equal(result.summary.medianScore,null);
});
test('attention pagination links target the matching management page and preserve analytics filters',()=>{
 const rows=Array.from({length:25},(_,i)=>question(i+1));
 const result=analyzeStatistics([],rows,statisticsWindow('all',time),{attention:'unseen',page:3,dataset:'exclude-demo'});
 assert.equal(result.candidates.length,5);assert.equal(result.pager.last,3);
 assert.equal(result.candidates.at(-1).url,'/questions?bank=0&status=approved&page=3#question-1');
 assert.match(result.pager.url(2),/period=all&dataset=exclude-demo&attention=unseen&page=2/);
});
test('long all-time trends aggregate by month and fill empty intervals',()=>{
 const rows=[record(1,{submitted_at:Date.parse('2025-10-01T00:00:00+08:00')/1000}),record(2)];
 const result=analyzeStatistics(rows,[],statisticsWindow('all',time));
 assert.equal(result.trend.unit,'month');assert.equal(result.trend.entries.length,13);
 assert.equal(result.trend.entries.reduce((n,e)=>n+e.attempts,0),2);
 assert.ok(result.trend.entries.some(e=>e.attempts===0));
});
test('statistics loading uses only SELECT queries and validates filters before reading',async()=>{
 const rows=[record(1)],questions=[question(1)],calls=[],before=JSON.stringify({rows,questions});
 const service=new StatisticsService({
  execute:async(sql,args)=>{calls.push({sql,args});return [rows];},
  query:async(sql)=>{calls.push({sql});return [questions];}
 },()=>time);
 await service.report({period:'7',dataset:'exclude-demo'});
 assert.equal(calls.length,2);assert.ok(calls.every(call=>/^SELECT /.test(call.sql)));
 assert.ok(calls[0].sql.includes('e.is_demo=0'));assert.ok(calls[0].sql.includes('JSON_TABLE'));
 assert.deepEqual(calls[0].args,[time+1,Date.parse('2026-10-24T00:00:00+08:00')/1000]);
 assert.equal(JSON.stringify({rows,questions}),before);
 for(const args of [{period:'invalid'},{dataset:'real'},{attention:'constructor'}])await assert.rejects(service.report(args),e=>e.status===422);
 assert.equal(calls.length,2);
});
