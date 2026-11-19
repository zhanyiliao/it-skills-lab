import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { CodexQuestionGenerator, validateQuestions } from '../src/services/ai-questions.js';
import { aiBanks, planQuestions } from '../src/services/ai-banks.js';
import {setupDatabase} from '../src/setup.js';
import { config } from '../src/config.js';
import {questionContentHash} from '../src/services/question-content.js';
import { root, runtime } from '../src/paths.js';

// Offline bootstrap only: no quiz, session, grading or statistics writes.
const hash = value => createHash('sha256').update(value).digest('hex');
const directory = path.join(runtime, 'question-bank-build');
await fs.mkdir(directory, { recursive: true });
const common = await fs.readFile(path.join(root, 'prompts/ai-exam.md'), 'utf8');
const subjects = await Promise.all(aiBanks.map(bank => fs.readFile(path.join(root, 'prompts', bank.prompt), 'utf8')));
const version = hash(common + subjects.join('\n'));
const manifestFile = path.join(directory, 'manifest.json');
let manifest;
try { manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (manifest && manifest.version !== version) throw Error('Prompt changed; archive the previous build directory before starting a new build.');
if (!manifest) {
  manifest = { version, batch: 'bootstrap-' + Date.now(), createdAt: Math.floor(Date.now()/1000),
    plans: Object.fromEntries(aiBanks.map(bank => [bank.id, planQuestions(50, [bank.id])])) };
  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2), { flag: 'wx' });
}
let completed = 0, nextBank = 0;
const result = new Map();
const normalize = text => text.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
async function generateBank(index) {
  const bank = aiBanks[index], questions = [];
  const run = new CodexQuestionGenerator().run;
  for (const [batchIndex, plan] of manifest.plans[bank.id].entries()) {
    const checkpoint = path.join(directory, bank.id + '-' + batchIndex + '.json');
    let batch;
    try { batch = validateQuestions(JSON.parse(await fs.readFile(checkpoint,'utf8')), plan); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!batch) {
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          const prompt = common + '\n\n' + subjects[index] +
            '\n\n本批必須依此順序與難度出題：\n' + JSON.stringify(plan) +
            '\n本批為本題庫第 ' + (batchIndex + 1) + ' 批，共 10 批。請主動輪替規格內的出題面向、情境和能力，避免集中在同一小節。' +
            '\n已採用題幹（不可重複或只改人名數字）：\n' + JSON.stringify(questions.map(q => q.question)) +
            '\n本批正解字母請盡量分散 A、B、C、D。';
          batch = validateQuestions(JSON.parse(await run(undefined, () => {}, { prompt, plan })), plan);
          const stems = new Set(questions.map(q => normalize(q.question)));
          for (const q of batch) { const stem=normalize(q.question); if(stems.has(stem))throw Error('Duplicate stem'); stems.add(stem); }
          await fs.writeFile(checkpoint, JSON.stringify({questions:batch}, null, 2), { flag: 'wx' });
          break;
        } catch (error) { console.error(bank.id, 'batch',batchIndex+1,'attempt',attempt,error.message); if(attempt===4)throw error; }
      }
    }
    questions.push(...batch); completed += batch.length;
    console.log(JSON.stringify({completed,total:400,bank:bank.id,bankCompleted:questions.length}));
  }
  result.set(bank.id, questions);
}
await Promise.all(Array.from({length:4}, async () => {
  while (nextBank < aiBanks.length) { const index = nextBank++; await generateBank(index); }
}));
const questions = aiBanks.flatMap(bank => result.get(bank.id));
if (questions.length !== 400 || new Set(questions.map(q=>normalize(q.question))).size!==400) throw Error('Expected 400 unique questions');
const columns = ['bank_code','question','A','B','C','D','answer','explanation','difficulty','review_status',
 'appearance_count','correct_count','unanswered_count','content_hash','generator','prompt_version','generation_batch','created_at'];
const rows = questions.map(q=>[aiBanks.find(bank=>bank.id===q.bank).code,q.question,q.options.A,q.options.B,q.options.C,q.options.D,q.answer,q.explanation,q.difficulty,
 'pending',0,0,0,questionContentHash(q),
 'codex-cli',version,manifest.batch,manifest.createdAt]);
if(new Set(rows.map(row=>row[13])).size!==400)throw Error('Duplicate content hash');
await setupDatabase({seed:false});
const db = await mysql.createConnection(config.db);
try {
  await db.beginTransaction();
  const [[{total}]] = await db.query('SELECT COUNT(*) AS total FROM questions');
  if(Number(total)!==0) {
    const [existing] = await db.query('SELECT '+columns.join(',')+' FROM questions');
    const expected = new Map(rows.map(row=>[row[13],row]));
    const contentColumns = columns.filter(column=>!['review_status','appearance_count','correct_count','unanswered_count'].includes(column));
    if(existing.length!==400 || existing.some(row=>{
      const match=expected.get(row.content_hash);
      return !match || contentColumns.some(column=>String(row[column])!==String(match[columns.indexOf(column)]));
    }))throw Error('Existing bank differs; refusing to overwrite');
    await db.rollback(); console.log('Existing identical 400-question bank preserved.');
  } else {
    await db.query('INSERT INTO questions ('+columns.join(',')+') VALUES ?', [rows]);
    await db.commit(); console.log('Inserted 400 questions. All pending; all counters zero.');
  }
  // Preserve completed reviews when resuming an already-populated bootstrap.
  const [statuses] = await db.query('SELECT content_hash,review_status FROM questions');
  const reviewStatus = new Map(statuses.map(row => [row.content_hash,row.review_status]));
  for (const row of rows) row[9] = reviewStatus.get(row[13]);
const seed = '-- Generated original questions. Import once into an empty questions table after schema.sql.\nSTART TRANSACTION;\nINSERT INTO questions ('+
 columns.join(',')+') VALUES\n'+rows.map(row=>'('+row.map(value=>mysql.escape(value)).join(',')+')').join(',\n')+';\nCOMMIT;\n';
await fs.writeFile(path.join(root,'database/questions-seed.sql'),seed);
  const [counts]=await db.query('SELECT bank_code,COUNT(*) AS total,MIN(difficulty) AS min_difficulty,MAX(difficulty) AS max_difficulty FROM questions GROUP BY bank_code');
  console.log(JSON.stringify(counts));
} catch(error){await db.rollback();throw error;} finally {await db.end();}
