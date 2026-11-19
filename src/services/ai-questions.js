import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { root, runtime } from '../paths.js';
import { fail, options } from '../support.js';
import { aiBanks, planQuestions, aiDifficultyMax } from './ai-banks.js';

const schema = path.join(root, 'src/schemas/generated-questions.json');
const promptFile = path.join(root, 'prompts/ai-exam.md');

export async function loadQuestionPrompt(file = promptFile) {
  let prompt;
  try { prompt = await fs.readFile(file, 'utf8'); }
  catch { fail(503, '出題規則無法讀取，請檢查出題設定。'); }
  if (!prompt.trim()) fail(503, '出題規則尚未填寫，請檢查出題設定。');
  return prompt;
}
async function executable() {
  if (config.codex.binary) return config.codex.binary;
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory.replace(/^"|"$/g, ''), name);
    try { await fs.access(candidate); return candidate; } catch {}
  }
  if (process.platform === 'win32') {
    const extensions = path.join(os.homedir(), '.vscode/extensions');
    const installed = await fs.readdir(extensions).catch(() => []);
    for (const entry of installed.filter(name => name.startsWith('openai.chatgpt-')).sort().reverse()) {
      const candidate = path.join(extensions, entry, 'bin/windows-x86_64/codex.exe');
      try { await fs.access(candidate); return candidate; } catch {}
    }
  }
  fail(503, '出題服務尚未設定完成。');
}
export function validateQuestions(value, plan) {
  const validText = (text, length) => typeof text === 'string' && text.trim().length > 0 && text.length <= length;
  if (!Array.isArray(plan) || plan.length !== 5 || !value || !Array.isArray(value.questions) || value.questions.length !== 5) fail(502, '出題結果不完整，請重新產生。');
  const questions = value.questions.map(q => {
    if (!q || !Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > aiDifficultyMax || !aiBanks.some(bank => bank.id === q.bank) ||
        !validText(q.question, 600) || !validText(q.explanation, 1000) || !q.options ||
        !options.every(option => validText(q.options[option], 300)) || !options.includes(q.answer) ||
        new Set(options.map(option => q.options[option].trim())).size !== 4) fail(502, '出題結果格式不正確，請重新產生。');
    return { question: q.question.trim(), options: Object.fromEntries(options.map(option => [option, q.options[option].trim()])),
      answer: q.answer, explanation: q.explanation.trim(), difficulty: q.difficulty, bank: q.bank };
  });
  if (new Set(questions.map(q => q.question)).size !== 5) fail(502, '出題結果有重複題目，請重新產生。');
  if (questions.some((question, index) => question.difficulty !== plan[index].difficulty || question.bank !== plan[index].bank))
    fail(502, '題庫或難度分配不完整，請重新產生。');
  return questions;
}
async function runCodex(signal,onProgress,task){
   const binary=await executable(),directory=path.join(runtime,'ai-generation');
   await fs.mkdir(directory,{recursive:true});
   const args=['exec','--ignore-user-config','--ephemeral','--sandbox','read-only','--skip-git-repo-check',
     '--color','never','--output-schema',task.schema??schema,
     '-c','project_doc_max_bytes=0','-c','web_search="disabled"','-c','features.shell_tool=false',
     '-c','features.apps=false','-c','features.multi_agent=false','-c','features.hooks=false','-c','features.memories=false'];
   if(config.codex.model)args.push('--model',config.codex.model);
   args.push('-');
   return new Promise((resolve,reject)=>{
     // Codex diagnostics may echo the full input; do not accumulate stderr in memory.
     const child=spawn(binary,args,{cwd:directory,windowsHide:true,shell:false,stdio:['pipe','pipe','ignore'],signal});
     let output='',bytes=0,settled=false,timedOut=false,tooLarge=false;
     const timer=setTimeout(()=>{timedOut=true;child.kill();},config.codex.timeout);
     timer.unref();
     const finish=error=>{
       if(settled)return;settled=true;clearTimeout(timer);
       if(error)reject(error);else resolve(output);
     };
     child.stdout.setEncoding('utf8');
     child.stdout.on('data',chunk=>{
       bytes+=Buffer.byteLength(chunk,'utf8');
       if(bytes>128*1024){tooLarge=true;child.kill();return;}
       output+=chunk;
     });
     child.once('error',error=>{
       if(error.name==='AbortError')return finish(error);
       console.error('Codex question generation failed:',error.code??error.name);
       finish(Object.assign(new Error('目前無法產生題目，請稍後再試。'),{status:503}));
     });
     child.once('close',code=>{
       if(settled)return;
       if(code===0&&!timedOut&&!tooLarge)return finish();
       console.error('Codex question generation failed:',timedOut?'timeout':tooLarge?'output limit':code);
       finish(Object.assign(new Error(timedOut?'出題等候逾時，請重新產生。':tooLarge?'出題結果過大，請重新產生。':'目前無法產生題目，請稍後再試。'),
         {status:timedOut?504:tooLarge?502:503}));
     });
     child.once('spawn',onProgress??(()=>{}));
     child.stdin.on('error',()=>{});
     child.stdin.end(task.prompt+'\n本次出題識別：'+randomUUID());
   });
 }
export class CodexQuestionGenerator {
  constructor(run = runCodex) { this.run = run; this.busy = false; }
  async generate({ amount = 10, banks = ['programming'], signal, onProgress = () => {} } = {}) {
    return this.generatePlanned({ plans: planQuestions(amount, banks), banks, signal, onProgress });
  }
  async generatePlanned({ plans, banks, signal, onProgress = () => {}, rules, context = '', avoidQuestions = [] }) {
    const flat = Array.isArray(plans) ? plans.flat() : [], amount = flat.length;
    if (!Array.isArray(plans) || !plans.length || amount > 50 || plans.some(plan => !Array.isArray(plan) || plan.length !== 5) ||
      !Array.isArray(banks) || flat.some(item => !banks.includes(item.bank) || !aiBanks.some(bank => bank.id === item.bank) ||
        !Number.isInteger(item.difficulty) || item.difficulty < 1 || item.difficulty > aiDifficultyMax))
      fail(422, '出題分配表不正確。');
    if (this.busy) fail(429, '目前有考卷正在產生，請稍後再試。');
    this.busy = true;
    const normalize = value => value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
    try {
      onProgress('preparing', { completed: 0, total: amount });
      if (rules === undefined) {
        const common = await loadQuestionPrompt();
        const subjects = await Promise.all(aiBanks.filter(bank => banks.includes(bank.id)).map(async bank =>
          '## 題庫：' + bank.id + '（' + bank.name + '）\n' + await loadQuestionPrompt(path.join(root, 'prompts', bank.prompt))));
        rules = common + '\n\n' + subjects.join('\n\n');
      }
      const questions = [], used = new Set(avoidQuestions.map(q => normalize(q.question)));
      for (const plan of plans) {
        signal?.throwIfAborted();
        const report = () => onProgress('generating', { completed: questions.length, total: amount });
        const prompt = rules + '\n\n' + context +
          '\n\n## 本批必須依序完成的題庫與星等\n' + JSON.stringify(plan) +
          '\n\n## 已抽出的題目與保留題目（不可重複其細節考點或只換數字）\n' + JSON.stringify(avoidQuestions) +
          '\n\n## 已完成的題幹（不可重複或只換數字）\n' + JSON.stringify(questions.map(q => q.question));
        const output = await this.run(signal, report, { kind: 'questions', prompt, plan });
        signal?.throwIfAborted();
        let data;
        try { data = JSON.parse(output); } catch { fail(502, '出題結果無法讀取，請重新產生。'); }
        const batch = validateQuestions(data, plan);
        for (const question of batch) {
          const stem = normalize(question.question);
          if (used.has(stem)) fail(502, '出題結果有重複題目，請重新產生。');
          used.add(stem);
        }
        questions.push(...batch);
        report();
      }
      onProgress('validating', { completed: amount, total: amount });
      return questions;
    } finally { this.busy = false; }
  }
}
