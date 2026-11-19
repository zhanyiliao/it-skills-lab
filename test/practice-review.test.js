import test from 'node:test';
import assert from 'node:assert/strict';
import { PRACTICE_REVIEW_TTL, practiceReviewSummary } from '../src/services/practice-review.js';

const session = () => ({ practice_result: {
  expires_at: 1000 + PRACTICE_REVIEW_TTL, score: 50,
  details: {version:2,questions:[{question_id:1,selected_answer:null}]},
} });

test('practice review expires at exactly one hour', () => {
  const value = session();
  assert.equal(PRACTICE_REVIEW_TTL, 3600);
  assert.ok(practiceReviewSummary(value, 1000 + 601));
  assert.ok(practiceReviewSummary(value, 1000 + 3599));
  assert.equal(practiceReviewSummary(value, 1000 + 3600), null);
  assert.equal(practiceReviewSummary(value, 1000 + 3601), null);
});

test('review entry contains only metadata and repeated reads do not renew the deadline', () => {
  const value = session(), before = JSON.stringify(value);
  assert.deepEqual(practiceReviewSummary(value, 1001), {
    title: '練習測驗檢討', amount: 1, score: 50, expires_at: 4600,
  });
  practiceReviewSummary(value, 4599);
  assert.equal(JSON.stringify(value), before);
  assert.deepEqual(Object.keys(practiceReviewSummary(value,1001)).sort(),['amount','expires_at','score','title']);
});

test('missing, incomplete or invalid deadlines never expose a review entry', () => {
  for (const value of [undefined, {}, {practice_result:{}}, {practice_result:{expires_at:4600}}])
    assert.equal(practiceReviewSummary(value, 1000), null);
  for (const expires_at of [undefined, '4600', NaN, Infinity, 4600.5]) {
    const value = session(); value.practice_result.expires_at = expires_at;
    assert.equal(practiceReviewSummary(value, 1000), null);
  }
});
