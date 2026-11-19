import test from 'node:test';
import assert from 'node:assert/strict';
import { drawDifficulty, sampleByDifficulty } from '../src/services/difficulty.js';
import { aiBanks, bankForCode } from '../src/services/ai-banks.js';
import { DailyQuestionService } from '../src/services/daily.js';

test('bank codes are explicit zero through seven with stable names and no duplicate identifiers',()=>{
  assert.deepEqual(aiBanks.map(bank=>bank.code),[0,1,2,3,4,5,6,7]);
  assert.equal(new Set(aiBanks.map(bank=>bank.id)).size,8);
  assert.equal(bankForCode(0).name,'計算機系統');assert.equal(bankForCode(7).name,'人工智慧應用');
});
test('difficulty chooses only remaining levels and handles exhausted stocks without repeated IDs',()=>{
  assert.equal(drawDifficulty(()=>0.5,[9]),9);
  const rows=[{id:1,difficulty:4},{id:2,difficulty:4},{id:3,difficulty:9}];
  const original=structuredClone(rows),sample=sampleByDifficulty(rows,3,()=>0.5);
  assert.equal(new Set(sample.map(q=>q.id)).size,3);assert.deepEqual(rows,original);
  assert.deepEqual(sampleByDifficulty(rows,0),[]);
  assert.throws(()=>sampleByDifficulty(rows,4),e=>e.status===422);
  assert.throws(()=>sampleByDifficulty([{id:1,difficulty:10}],1),e=>e.status===409);
});
test('database sampling follows normal level weights rather than multiplying them by stock counts',()=>{
  const rows=Array.from({length:9},(_,i)=>({id:i,difficulty:i+1}));
  for(let i=0;i<40;i++)rows.push({id:9+i,difficulty:4});
  const samples=10000,counts=Array(9).fill(0);let call=0,draw=0;
  const random=()=>call++%2===0?(draw+++0.5)/samples:0;
  for(let i=0;i<samples;i++)counts[sampleByDifficulty(rows,1,random)[0].difficulty-1]++;
  const expected=[0.0363,0.1103,0.2149,0.2683,0.2149,0.1103,0.0363,0.0077,0.0010];
  for(let i=0;i<9;i++)assert.ok(Math.abs(counts[i]/samples-expected[i])<0.0002);
  assert.equal(counts.indexOf(Math.max(...counts))+1,4);
});
test('daily selection uses the same nine-level curve while remaining fixed for each date',async()=>{
  const keys=Array.from({length:9},(_,i)=>({id:i+1,difficulty:i+1}));
  const service=new DailyQuestionService({approvedIds:async()=>keys,findApproved:async(id)=>({
    id,bank_code:0,difficulty:id,question:'Q',A:'A',B:'B',C:'C',D:'D',answer:'A',explanation:'E',
  })},'secret');
  const counts=Array(9).fill(0);
  for(let i=0;i<3000;i++){
    const date=new Date(Date.UTC(2020,0,i+1)).toISOString().slice(0,10);
    counts[(await service.today(date)).difficulty-1]++;
  }
  assert.equal(counts.indexOf(Math.max(...counts))+1,4);
  assert.ok(counts[8]<counts[7]);assert.ok(counts[0]<counts[1]);
  assert.deepEqual(await service.today('2026-10-28'),await service.today('2026-10-28'));
});
