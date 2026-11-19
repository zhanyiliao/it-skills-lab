import test from 'node:test';
import assert from 'node:assert/strict';
import {readAnswerReferences} from '../src/services/answer-records.js';
import { PracticeQuestionRepository } from '../src/services/practice-questions.js';
test('compact review rejects invalid, repeated or unsafe primary keys and invalid answers',()=>{
  for(const questions of [[],[{question_id:0,selected_answer:null}],[{question_id:Number.MAX_SAFE_INTEGER+1,selected_answer:null}],
    [{question_id:1,selected_answer:'E'}],[{question_id:1,selected_answer:null},{question_id:1,selected_answer:'A'}]]){
    assert.throws(()=>readAnswerReferences({version:2,questions}),e=>e.status===409);
  }
});
test('reference review preserves order and blank answers, escapes bank text and handles missing questions',async()=>{
  const repo=new PracticeQuestionRepository({execute:async(sql,ids)=>{
    assert.deepEqual(ids,[2,1,3]);
    return [[{id:1,bank_code:5,question:'if (x < 3) <script>bad()</script>',A:'<img src=x>',B:'B',C:'C',D:'D',
      answer:'B',difficulty:9,explanation:'Explanation'},{id:2,bank_code:2,question:'Q2',A:'A',B:'B',C:'C',D:'D',
      answer:'A',difficulty:5,explanation:'E'}]];
  }});
  const rows=await repo.reviewRows({version:2,questions:[{question_id:2,selected_answer:'A'},{question_id:1,selected_answer:null},{question_id:3,selected_answer:'D'}]});
  assert.equal(rows[0].correct,true);assert.equal(rows[1].selection,'N');assert.equal(rows[1].difficulty_scale,9);
  assert.match(rows[1].question,/&lt;script&gt;/);assert.doesNotMatch(rows[1].A,/<img/);
  assert.equal(rows[2].missing,true);assert.equal(rows[2].selection,'D');assert.equal(rows[2].position,3);
});

test('floating difficulty is calculated on request from current counters without changing base scores',async()=>{
  const row={id:1,bank_code:5,question:'題目',A:'甲',B:'乙',C:'丙',D:'丁',answer:'A',difficulty:5,
    explanation:'解析',appearance_count:100,correct_count:80,unanswered_count:0};
  const repo=new PracticeQuestionRepository({execute:async()=>[[row]]});
  const details={version:2,questions:[{question_id:1,selected_answer:'A'}]};
  const initial=(await repo.reviewRows(details))[0];
  assert.equal(initial.difficulty,5);assert.equal(initial.floating_difficulty,undefined);
  assert.equal((await repo.reviewRows(details,{includeFloatingDifficulty:true}))[0].floating_difficulty.toFixed(2),'4.59');
  assert.equal(await repo.score(details),100);
  row.correct_count=20;
  const changed=(await repo.reviewRows(details,{includeFloatingDifficulty:true}))[0];
  assert.equal(changed.floating_difficulty.toFixed(2),'5.55');assert.equal(changed.difficulty,5);
  assert.equal(await repo.score(details),100);
});
