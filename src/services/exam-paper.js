import { randomBytes } from 'node:crypto';
import { aiBanks, aiAmounts, aiDifficultyMax } from './ai-banks.js';
import { now, options, fail } from '../support.js';

const html = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export { html as questionTextHtml };

/** Freeze a prepared paper for the active exam; submitted records contain references only. */
export function createPaper(questions, amount, selected, { allowRepeatedStems = false } = {}) {
  if (!aiAmounts.includes(amount) || !Array.isArray(questions) || questions.length !== amount)
    fail(502, '考卷題數不完整，請重新產生。');
  const counts = new Map(selected.map(bank => [bank, 0]));
  const snapshot = { version: 1, difficulty_scale: aiDifficultyMax, questions: questions.map(question => {
    const bank = aiBanks.find(bank => bank.id === question.bank && counts.has(bank.id));
    if (!bank || !Number.isInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > aiDifficultyMax ||
        typeof question.explanation !== 'string' || !question.explanation.trim()) fail(502, '考卷資料不完整，請重新產生。');
    counts.set(bank.id, counts.get(bank.id) + 1);
    return { bank_name: bank.name, question: html(question.question),
      options: Object.fromEntries(options.map(option => [option, html(question.options[option])])),
      correct_answer: question.answer, selected_answer: null, difficulty: question.difficulty,
      explanation: question.explanation };
  }) };
  const totals = [...counts.values()];
  if (totals.some(count => count === 0) || Math.max(...totals) - Math.min(...totals) > 1 ||
      (!allowRepeatedStems && new Set(questions.map(question => question.question.trim())).size !== amount))
    fail(502, '考卷的題目或題庫分配不完整，請重新產生。');
  readPaper(snapshot);
  return { mode: 'practice', source: 'bank', snapshot, started_at: now(), nonce: randomBytes(24).toString('hex') };
}

/** Active-paper validation. Completed records contain only question references. */
export function readPaper(value){
  let data=value;
  try{if(typeof data==='string')data=JSON.parse(data);}catch{fail(409,'考卷格式無法讀取。');}
  if(!data||data.version!==1||data.difficulty_scale!==aiDifficultyMax||!Array.isArray(data.questions)||
    !data.questions.length||data.questions.length>50||!data.questions.every(q=>q&&
      typeof q.bank_name==='string'&&q.bank_name.length&&typeof q.question==='string'&&
      options.every(option=>typeof q.options?.[option]==='string')&&options.includes(q.correct_answer)&&
      (q.selected_answer===null||options.includes(q.selected_answer))&&
      Number.isInteger(q.difficulty)&&q.difficulty>=1&&q.difficulty<=aiDifficultyMax&&typeof q.explanation==='string'))
    fail(409,'考卷格式無法讀取。');
  return data;
}
export function paperRows(value){
  return readPaper(value).questions.map((q,index)=>({
    bank_name:q.bank_name,question:q.question,...q.options,answer:q.correct_answer,selection:q.selected_answer??'N',
    correct:q.selected_answer===q.correct_answer,position:index+1,difficulty:q.difficulty,
    difficulty_scale:aiDifficultyMax,explanation:q.explanation
  }));
}
