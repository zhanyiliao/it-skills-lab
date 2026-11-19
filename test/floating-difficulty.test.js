import test from 'node:test';
import assert from 'node:assert/strict';
import {floatingDifficulty} from '../src/services/floating-difficulty.js';

const question=(difficulty,appearance_count=0,correct_count=0,unanswered_count=0)=>({difficulty,appearance_count,correct_count,unanswered_count});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,a+' != '+b);
test('every base level remains unchanged at its own expected success rate',()=>{
 const correct=[360,330,300,270,240,210,180,150,120];
 for(let level=1;level<=9;level++){
  near(floatingDifficulty(question(level)),level);
  near(floatingDifficulty(question(level,400,correct[level-1])),level);
 }
});
test('sample smoothing strengthens deviations and preserves the selected asymmetric normalization',()=>{
 near(floatingDifficulty(question(5,10,8)),4.835);
 near(floatingDifficulty(question(5,100,80)),4.5875);
 near(floatingDifficulty(question(5,100,50)),5.1375);
 assert.ok(floatingDifficulty(question(1,100,50))>1);
 assert.ok(floatingDifficulty(question(9,100,50))<9);
});
test('blank submissions do not change difficulty or count as wrong calibration answers',()=>{
 near(floatingDifficulty(question(5,100,0,100)),5);
 near(floatingDifficulty(question(5,110,8,100)),floatingDifficulty(question(5,10,8)));
});
test('extreme results can display 0.01 and 9.99 without reaching the mathematical limits',()=>{
 const low=floatingDifficulty(question(1,10000,10000)),high=floatingDifficulty(question(9,10000,0));
 assert.equal(low.toFixed(2),'0.01');assert.equal(high.toFixed(2),'9.99');
 assert.ok(low>0.01);assert.ok(high<9.99);
 for(let level=1;level<=9;level++)for(const correct of [0,10000]){
  const value=floatingDifficulty(question(level,10000,correct));
  assert.ok(value>level-0.99&&value<level+0.99);
 }
});
test('calculation leaves stored base difficulty and counters intact and rejects invalid statistics',()=>{
 const value=question(5,100,80),before=JSON.stringify(value);
 floatingDifficulty(value);assert.equal(JSON.stringify(value),before);
 for(const value of [question(0),question(10),question(5,-1),question(5,10,11),question(5,10,5,6),question(5,1.5)])
  assert.throws(()=>floatingDifficulty(value),e=>e.status===409);
});
