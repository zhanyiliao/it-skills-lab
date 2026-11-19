import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CodexQuestionGenerator, validateQuestions, loadQuestionPrompt } from '../src/services/ai-questions.js';
import { aiBanks, aiAmounts, aiSettings, planQuestions } from '../src/services/ai-banks.js';
import {createPaper,readPaper,paperRows} from '../src/services/exam-paper.js';

const batchPlan = [1, 4, 4, 9, 5].map(difficulty => ({ bank: 'programming', difficulty }));
const fixture = (plan = batchPlan, serial = 0) => ({ questions: plan.map((item, index) => ({
  ...item, question: '題目 ' + serial + '：' + item.bank + ' ' + index,
  options: { A: '甲', B: '乙', C: '丙', D: '丁' }, answer: 'B', explanation: '依題目條件，乙才成立。',
})) });
test('AI settings offer eight subjects and only 10, 25 or 50 questions', () => {
  assert.equal(aiBanks.length, 8);
  assert.deepEqual(aiAmounts, [10, 25, 50]);
  assert.deepEqual(aiSettings('10', ['ai-applications', 'programming', 'programming']), { amount: 10, banks: ['programming', 'ai-applications'] });
  for (const [amount, banks] of [[0, ['programming']], [5, ['programming']], [9, ['programming']], [51, ['programming']], [10, []], [10, ['unknown']], [10, 'programming']])
    assert.throws(() => aiSettings(amount, banks), error => error.status === 422);
});

test('whole-paper plans cover every selected bank, even all eight in ten questions', () => {
  for (const amount of aiAmounts) for (let count = 1; count <= aiBanks.length; count++) {
    const selected = aiBanks.slice(0, count).map(bank => bank.id), batches = planQuestions(amount, selected);
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

test('batch validation preserves assignment order and accepts repeated stars up to nine', () => {
  assert.deepEqual(validateQuestions(fixture(), batchPlan).map(q => q.difficulty), [1, 4, 4, 9, 5]);
  for (const mutate of [
    data => data.questions.pop(),
    data => { data.questions[1].question = data.questions[0].question; },
    data => { data.questions[0].options.B = data.questions[0].options.A; },
    data => { data.questions[0].answer = 'E'; },
    data => { data.questions[0].explanation = ' '; },
    data => { data.questions[0].bank = 'unknown'; },
    data => { data.questions[0].bank = 'project-management'; },
    data => { data.questions[0].difficulty = '1'; },
    data => { data.questions[0].difficulty = 0; },
    data => { data.questions[0].difficulty = 10; },
    data => { data.questions[0].difficulty = 1.5; },
    data => { data.questions[4].difficulty = 3; },
    data => data.questions.reverse(),
  ]) {
    const data = fixture(); mutate(data);
    assert.throws(() => validateQuestions(data, batchPlan), error => error.status === 502);
  }
  assert.throws(() => validateQuestions(fixture(), []), error => error.status === 502);
});

test('generation reads all eight subject rules and the schema accepts every registered bank', async () => {
  const generator = new CodexQuestionGenerator(async (signal, progress, task) => {
    for (const bank of aiBanks) assert.ok(task.prompt.includes('## 題庫：' + bank.id + '（' + bank.name + '）'));
    return JSON.stringify(fixture(task.plan, ++serial));
  });
  let serial = 0;
  const questions = await generator.generate({ amount: 10, banks: aiBanks.map(bank => bank.id) });
  assert.equal(new Set(questions.map(q => q.bank)).size, 8);
  const schema = JSON.parse(await fs.readFile(new URL('../src/schemas/generated-questions.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.properties.questions.items.properties.bank.enum, aiBanks.map(bank => bank.id));
  assert.deepEqual(schema.properties.questions.items.properties.difficulty.enum, [1,2,3,4,5,6,7,8,9]);
});

test('generation reports completed batches without inventing progress', async () => {
  let calls = 0;
  const stages = [];
  const generator = new CodexQuestionGenerator(async (signal, progress, task) => {
    calls++;
    assert.match(task.prompt, /本批必須依序完成/);
    assert.match(task.prompt, /# 程式設計/);
    assert.ok(!task.prompt.includes('# 專案管理'));
    if (calls === 2) assert.match(task.prompt, /題目 1/);
    progress();
    return JSON.stringify(fixture(task.plan, calls));
  });
  const questions = await generator.generate({ amount: 10, banks: ['programming'], onProgress: (stage, counts) => stages.push({ stage, ...counts }) });
  assert.equal(calls, 2); assert.equal(questions.length, 10);
  assert.deepEqual(stages.map(item => [item.stage, item.completed]), [
    ['preparing', 0], ['generating', 0], ['generating', 5], ['generating', 5], ['generating', 10], ['validating', 10],
  ]);
});

test('a whole paper reserves one generation slot and releases it on completion, invalid output or abort', async () => {
  let finish, entered, calls = 0;
  const ready = new Promise(resolve => { entered = resolve; });
  const generator = new CodexQuestionGenerator((signal, progress, task) => {
    const serial = ++calls;
    if (serial > 1) return Promise.resolve(JSON.stringify(fixture(task.plan, serial)));
    return new Promise(resolve => { finish = () => resolve(JSON.stringify(fixture(task.plan, serial))); entered(); });
  });
  const first = generator.generate();
  await ready;
  await assert.rejects(generator.generate(), error => error.status === 429);
  finish(); await first; assert.equal(generator.busy, false);
  const invalid = new CodexQuestionGenerator(async () => 'not JSON');
  await assert.rejects(invalid.generate(), error => error.status === 502);
  assert.equal(invalid.busy, false);
  const controller = new AbortController(); controller.abort();
  const aborted = new CodexQuestionGenerator(async () => { throw new Error('must not run'); });
  await assert.rejects(aborted.generate({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(aborted.busy, false);
});

test('repeated questions across batches are rejected', async () => {
  const generator = new CodexQuestionGenerator(async (signal, progress, task) => JSON.stringify(fixture(task.plan)));
  await assert.rejects(generator.generate({ amount: 10 }), error => error.status === 502);
  assert.equal(generator.busy, false);
});

test('prepared papers escape model text, preserve a nine-star scale and reject incomplete bank coverage', () => {
  const data = fixture([...batchPlan, ...batchPlan]).questions;
  data[0].question = 'if (x < 3)\n  <img src=x onerror=bad()>';
  data[0].options.A = '<script>bad()</script>';
  data[0].explanation = '<script>解析</script>';
  const paper = createPaper(data, 10, ['programming']);
  assert.equal(paper.mode, 'practice'); assert.equal(paper.source, 'bank');
  assert.match(paper.nonce, /^[a-f0-9]{48}$/);
  const rows = paperRows(readPaper(paper.snapshot));
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
  const all = aiBanks.map(bank => bank.id), mixed = fixture(planQuestions(10, all).flat()).questions;
  assert.equal(new Set(createPaper(mixed, 10, all).snapshot.questions.map(q => q.bank_name)).size, 8);
});

test('prompt files are read afresh and empty or missing rules are rejected', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'it-skills-prompt-')), file = path.join(directory, 'rules.md');
  try {
    await fs.writeFile(file, '# First rules\n', 'utf8');
    assert.equal(await loadQuestionPrompt(file), '# First rules\n');
    await fs.writeFile(file, '# Revised rules\n', 'utf8');
    assert.equal(await loadQuestionPrompt(file), '# Revised rules\n');
    await fs.writeFile(file, ' \n', 'utf8');
    await assert.rejects(loadQuestionPrompt(file), error => error.status === 503);
    await fs.unlink(file);
    await assert.rejects(loadQuestionPrompt(file), error => error.status === 503);
  } finally { await fs.rm(file, { force: true }); await fs.rmdir(directory); }
});
