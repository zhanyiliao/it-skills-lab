import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CodexQuestionGenerator, validateQuestions, loadQuestionPrompt } from '../src/services/ai-questions.js';
import { questionBanks, planQuestions } from '../src/services/question-banks.js';

const generationSettings = (extra = {}) => ({ banks: ['programming'], plans: [batchPlan, batchPlan], ...extra });

const batchPlan = [1, 4, 4, 9, 5].map(difficulty => ({ bank: 'programming', difficulty }));
const fixture = (plan = batchPlan, serial = 0) => ({ questions: plan.map((item, index) => ({
  ...item, question: '題目 ' + serial + '：' + item.bank + ' ' + index,
  options: { A: '甲', B: '乙', C: '丙', D: '丁' }, answer: 'B', explanation: '依題目條件，乙才成立。',
})) });
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
    for (const bank of questionBanks) assert.ok(task.prompt.includes('## 題庫：' + bank.id + '（' + bank.name + '）'));
    return JSON.stringify(fixture(task.plan, ++serial));
  });
  let serial = 0;
  const questions = await generator.generatePlanned(generationSettings({ banks: questionBanks.map(bank => bank.id), plans: planQuestions(10, questionBanks.map(bank => bank.id)) }));
  assert.equal(new Set(questions.map(q => q.bank)).size, 8);
  const schema = JSON.parse(await fs.readFile(new URL('../src/schemas/generated-questions.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.properties.questions.items.properties.bank.enum, questionBanks.map(bank => bank.id));
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
  const questions = await generator.generatePlanned(generationSettings({ onProgress: (stage, counts) => stages.push({ stage, ...counts }) }));
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
  const first = generator.generatePlanned(generationSettings());
  await ready;
  await assert.rejects(generator.generatePlanned(generationSettings()), error => error.status === 429);
  finish(); await first; assert.equal(generator.busy, false);
  const invalid = new CodexQuestionGenerator(async () => 'not JSON');
  await assert.rejects(invalid.generatePlanned(generationSettings()), error => error.status === 502);
  assert.equal(invalid.busy, false);
  const controller = new AbortController(); controller.abort();
  const aborted = new CodexQuestionGenerator(async () => { throw new Error('must not run'); });
  await assert.rejects(aborted.generatePlanned(generationSettings({ signal: controller.signal })), { name: 'AbortError' });
  assert.equal(aborted.busy, false);
});

test('repeated questions across batches are rejected', async () => {
  const generator = new CodexQuestionGenerator(async (signal, progress, task) => JSON.stringify(fixture(task.plan)));
  await assert.rejects(generator.generatePlanned(generationSettings()), error => error.status === 502);
  assert.equal(generator.busy, false);
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
