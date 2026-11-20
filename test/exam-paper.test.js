import test from 'node:test';
import assert from 'node:assert/strict';
import { questionBanks, planQuestions } from '../src/services/question-banks.js';
import { createPaper, paperRows } from '../src/services/exam-paper.js';

const batchPlan = [1, 4, 4, 9, 5].map(difficulty => ({ bank: 'programming', difficulty }));
const fixture = plan => ({ questions: plan.map((item, index) => ({
  ...item, question: '題目 ' + index, options: { A: '甲', B: '乙', C: '丙', D: '丁' },
  answer: 'B', explanation: '解析',
})) });
test('prepared papers escape model text, preserve a nine-star scale and reject incomplete bank coverage', () => {
  const data = fixture([...batchPlan, ...batchPlan]).questions;
  data[0].question = 'if (x < 3)\n  <img src=x onerror=bad()>';
  data[0].options.A = '<script>bad()</script>';
  data[0].explanation = '<script>解析</script>';
  const paper = createPaper(data, 10, ['programming']);
  assert.equal(paper.mode, 'practice'); assert.equal(paper.source, 'bank');
  assert.match(paper.nonce, /^[a-f0-9]{48}$/);
  const rows = paperRows(paper.snapshot);
  assert.match(rows[0].question, /x &lt; 3/);
  assert.ok(!rows[0].question.includes('<img'));
  assert.ok(!rows[0].A.includes('<script'));
  assert.equal(rows[0].explanation, '<script>解析</script>');
  assert.deepEqual(rows.map(q => q.difficulty), [1,4,4,9,5,1,4,4,9,5]);
  assert.ok(rows.every(q => q.difficulty_scale === 9));
  assert.throws(() => createPaper(data.slice(0, 5), 5, ['programming']), error => error.status === 502);
  assert.throws(() => createPaper(data, 25, ['programming']), error => error.status === 502);
  assert.throws(() => createPaper(data, 10, ['programming', 'ai-applications']), error => error.status === 502);
  assert.throws(() => createPaper(data, 10, ['ai-applications']), error => error.status === 502);
  const all = questionBanks.map(bank => bank.id), mixed = fixture(planQuestions(10, all).flat()).questions;
  assert.equal(new Set(createPaper(mixed, 10, all).snapshot.questions.map(q => q.bank_name)).size, 8);
});
