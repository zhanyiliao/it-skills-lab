import test from 'node:test';
import assert from 'node:assert/strict';
import {weightedScore,recordScoreSql} from '../src/services/scoring.js';
import {formatScore} from '../src/support.js';
import {paperRows} from '../src/services/exam-paper.js';

test('difficulty changes the contribution of correct answers',()=>{
 assert.equal(weightedScore([{difficulty:1,correct:true},{difficulty:9,correct:false}]),10);
 assert.equal(weightedScore([{difficulty:1,correct:false},{difficulty:9,correct:true}]),90);
});
test('weighted scores round once to two decimals, including halfway values',()=>{
 assert.equal(weightedScore([{difficulty:1,correct:true},{difficulty:2,correct:false}]),33.33);
 assert.equal(weightedScore([{difficulty:2,correct:true},{difficulty:1,correct:false}]),66.67);
 assert.equal(weightedScore(Array.from({length:32},(_,i)=>({difficulty:1,correct:i===0}))),3.13);
});
test('all correct, blank and empty results stay within zero and one hundred',()=>{
 for(const correct of [false,true])assert.equal(weightedScore(Array.from({length:50},(_,i)=>({difficulty:i%9+1,correct}))),correct?100:0);
 assert.equal(weightedScore([]),0);
 for(const rows of [[{difficulty:0}],[{difficulty:10}],[{difficulty:2.5}],[{difficulty:4,missing:true}]])
  assert.throws(()=>weightedScore(rows),e=>e.status===409);
});
test('score presentation preserves trailing decimal places and the full-score boundary',()=>{
 for(const [value,expected] of [[0,'0.00'],[100,'100.00'],[1.2,'1.20'],['98.76','98.76']])assert.equal(formatScore(value),expected);
 assert.throws(()=>recordScoreSql('e;DROP TABLE user'));
});
test('submission scores use frozen difficulty weights and count unanswered questions in the denominator',()=>{
 const q=(difficulty,selected_answer)=>({bank_name:'程式設計',question:'題目',options:{A:'甲',B:'乙',C:'丙',D:'丁'},correct_answer:'A',selected_answer,difficulty,explanation:'解析'});
 const details={version:1,difficulty_scale:9,questions:[q(9,'A'),q(1,null)]};
 assert.equal(weightedScore(paperRows(details)),90);details.questions[0].selected_answer=null;assert.equal(weightedScore(paperRows(details)),0);
});
