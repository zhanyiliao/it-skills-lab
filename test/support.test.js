import test from 'node:test';
import assert from 'node:assert/strict';
import { pager } from '../src/support.js';
import { bankPerformance } from '../src/services/scoring.js';
import { DailyQuestionService } from '../src/services/daily.js';

test('pagination windows preserve boundaries and query parameters',()=>{
for(const [page,expected] of [[1,[1,2,3,16]],[2,[1,2,3,4,16]],[3,[1,2,3,4,5,16]],[4,[1,2,3,4,5,6,16]],[5,[1,3,4,5,6,7,16]],[7,[1,5,6,7,8,9,16]],[16,[1,14,15,16]]]) {
    const result=pager(160,10,page,'/questions',{bank:2});
    assert.deepEqual(result.numbers,expected);
    assert.equal(result.url(3),'/questions?bank=2&page=3#pagination');
}

});
test('subject statistics group only stored names and include unanswered questions',()=>{
  const stats=bankPerformance([{bank_name:'計算機系統',correct:true},{bank_name:'計算機系統',correct:false},{bank_name:'程式設計',correct:false}]);
  assert.equal(stats.find(bank=>bank.name==='計算機系統').rate,50);
  assert.equal(stats.find(bank=>bank.name==='程式設計').rate,0);
  assert.equal(stats.length,2);
});
test('daily selection survives restarts and pool order changes; revisions invalidate signatures',async()=>{
  let revision='question', explanation='Explanation';
  const rows=[{id:1,difficulty:4},{id:351,difficulty:4}];
  const repository={approvedIds:async()=>rows,findApproved:async(id)=>({id,bank_code:5,difficulty:4,question:revision,A:'a',B:'b',C:'c',D:'d',answer:'A',explanation})};
  const service=new DailyQuestionService(repository,'secret');
  const first=await service.today('2026-10-22'); rows.reverse();
  const second=await new DailyQuestionService(repository,'secret').today('2026-10-22');
  assert.deepEqual(first,second);
  const submission={date:first.date,question_id:first.id,signature:first.signature,choice:'A',user_id:7};
  assert.ok(service.result(first,submission,{identity:7}).correct);
  assert.equal(service.result(first,submission,{identity:7}).explanation,'Explanation');
  assert.equal(service.result(first,submission,{identity:8}),null);
  assert.equal(service.matches(first,{...submission,question_id:first.id+1}),false);
  assert.equal(service.matches(first,{...submission,date:'2026-10-23'}),false);
  revision='changed'; assert.equal(service.matches(await service.today('2026-10-22'),submission),false);
  revision='question';explanation='Changed explanation';
  assert.equal(service.matches(await service.today('2026-10-22'),submission),false);
});
test('daily question handles an empty approved bank or a selected row removed during lookup',async()=>{
  for(const repository of [{approvedIds:async()=>[]},{approvedIds:async()=>[{id:1,difficulty:4}],findApproved:async()=>null}]){
    assert.equal(await new DailyQuestionService(repository,'secret').today('2026-10-22'),null);
  }
});
