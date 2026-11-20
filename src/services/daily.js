import { createHash, createHmac } from 'node:crypto';
import { options, safeEqual, integer } from '../support.js';
import { bankForCode } from './question-banks.js';
import { drawDifficulty } from './difficulty.js';
export class DailyQuestionService {
  constructor(questions, secret) { this.questions = questions; this.secret = secret; }
  async today(date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date())) {
    // Formal questions admitted today enter tomorrow's daily pool, keeping today's selection fixed.
    const cutoff = Math.floor(Date.parse(date + 'T00:00:00+08:00') / 1000);
    const pool = await this.questions.approvedIds(cutoff);
    if (!pool.length) return null;
    const levels = [...new Set(pool.map(row => row.difficulty))].sort((a,b) => a-b);
    const seed = createHash('sha256').update('daily-difficulty-v1|' + date).digest('hex');
    const difficulty = drawDifficulty(() => parseInt(seed.slice(0, 13), 16) / 2 ** 52, levels);
    let selected = null, best = null;
    for (const key of pool.filter(row => row.difficulty === difficulty)) {
      const hash = createHash('sha256').update('daily-question-v2|' + date + '|' + key.id).digest('hex');
      if (best === null || hash < best) { best = hash; selected = key; }
    }
    if (!selected) return null;
    const row = await this.questions.findApproved(selected.id);
    if (!row) return null;
    const revision = [date, row.id, row.bank_code, ...['question', ...options, 'answer', 'explanation', 'difficulty'].map(key => row[key])];
    return { ...row, id: Number(row.id), bank_name: bankForCode(row.bank_code)?.name ?? String(row.bank_code),
      date, signature: createHmac('sha256', this.secret).update(JSON.stringify(revision)).digest('hex') };
  }
  matches(question, value) {
    return !!question && value?.date === question.date && integer(value.question_id) === question.id
      && safeEqual(value.signature, question.signature);
  }
  result(question, submission, user) {
    if (!user || submission?.user_id !== user.identity || !this.matches(question, submission) || !options.includes(submission.choice)) return null;
    return { choice: submission.choice, answer: question.answer, correct: submission.choice === question.answer, explanation: question.explanation };
  }
}
