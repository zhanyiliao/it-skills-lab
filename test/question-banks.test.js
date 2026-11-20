import test from 'node:test';
import assert from 'node:assert/strict';
import { questionBanks, practiceAmounts, practiceSettings, planQuestions } from '../src/services/question-banks.js';
test('practice settings offer eight subjects and only 10, 25 or 50 questions', () => {
  assert.equal(questionBanks.length, 8);
  assert.deepEqual(practiceAmounts, [10, 25, 50]);
  assert.deepEqual(practiceSettings('10', ['ai-applications', 'programming', 'programming']), { amount: 10, banks: ['programming', 'ai-applications'] });
  for (const [amount, banks] of [[0, ['programming']], [5, ['programming']], [9, ['programming']], [51, ['programming']], [10, []], [10, ['unknown']], [10, 'programming']])
    assert.throws(() => practiceSettings(amount, banks), error => error.status === 422);
});

test('whole-paper plans cover every selected bank, even all eight in ten questions', () => {
  for (const amount of practiceAmounts) for (let count = 1; count <= questionBanks.length; count++) {
    const selected = questionBanks.slice(0, count).map(bank => bank.id), batches = planQuestions(amount, selected);
    assert.equal(batches.length, amount / 5);
    assert.ok(batches.every(batch => batch.length === 5));
    const plan = batches.flat();
    assert.equal(plan.length, amount);
    const counts = selected.map(bank => plan.filter(item => item.bank === bank).length);
    assert.ok(counts.every(count => count >= 1));
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
    assert.ok(plan.every(item => Number.isInteger(item.difficulty) && item.difficulty >= 1 && item.difficulty <= 9));
  }
  const middle = planQuestions(10, ['programming'], () => 0.5).flat();
  assert.ok(middle.every(item => item.difficulty === middle[0].difficulty));
  assert.ok(middle[0].difficulty === 4);
  assert.ok(planQuestions(10, ['programming'], () => 0).flat().every(item => item.difficulty === 1));
  assert.ok(planQuestions(10, ['programming'], () => 1 - Number.EPSILON).flat().every(item => item.difficulty === 9));
});

test('difficulty draws follow the specified discrete normal curve rather than uniform quotas', () => {
  const counts = Array(9).fill(0), samples = 10000;
  let draw = 0;
  for (let paper = 0; paper < samples / 50; paper++)
    for (const item of planQuestions(50, ['programming'], () => (draw++ + 0.5) / samples).flat()) counts[item.difficulty - 1]++;
  const expected = [0.0363, 0.1103, 0.2149, 0.2683, 0.2149, 0.1103, 0.0363, 0.0077, 0.0010];
  for (let index = 0; index < 9; index++) assert.ok(Math.abs(counts[index] / samples - expected[index]) < 0.0002);
});
