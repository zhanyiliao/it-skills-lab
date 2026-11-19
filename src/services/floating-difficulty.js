import {fail} from '../support.js';

const PRIOR_WEIGHT=20;
const MAX_ADJUSTMENT=0.99;

/** Base difficulty and counters remain immutable during review. Blank answers are excluded. */
export function floatingDifficulty(question){
  const {difficulty,appearance_count,correct_count,unanswered_count}=question;
  if(!Number.isInteger(difficulty)||difficulty<1||difficulty>9||
    ![appearance_count,correct_count,unanswered_count].every(n=>Number.isSafeInteger(n)&&n>=0)||
    correct_count+unanswered_count>appearance_count)
    fail(409,'題目難度或作答統計不完整，無法計算浮動難度。');
  const answered=appearance_count-unanswered_count;
  const expected=(90-7.5*(difficulty-1))/100;
  // Equivalent to smoothing the success rate toward its base-level expectation,
  // then normalizing the deviation by the available upward or downward range.
  const deviation=answered*expected-correct_count;
  const range=deviation>=0?expected:1-expected;
  return difficulty+MAX_ADJUSTMENT*deviation/((answered+PRIOR_WEIGHT)*range);
}
