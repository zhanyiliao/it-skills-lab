import { randomBytes } from 'node:crypto';
import { transaction, one } from '../db.js';
import { fail, safeEqual, now, options } from '../support.js';

export const LEAVE_GRACE = 30;
export const LOST_CONNECTION_GRACE = 120;
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
const unfinished = row => row && row.result === null;

/** One durable paper per account. */
export class ActiveExamService {
  constructor(pool, exams, clock = now) { this.pool = pool; this.exams = exams; this.clock = clock; }
  async hasPending(userId) {
    return Boolean(await one(this.pool, 'SELECT user_id FROM node_active_exams WHERE user_id=? AND result IS NULL', [userId]));
  }
  async currentNonce(userId) {
    return (await one(this.pool, 'SELECT nonce FROM node_active_exams WHERE user_id=?', [userId]))?.nonce ?? null;
  }
  async locked(userId, work) {
    return transaction(this.pool, async db => {
      const user = await one(db, 'SELECT identity FROM user WHERE identity=? FOR UPDATE', [userId]);
      if (!user) fail(401, '帳號不存在。');
      const row = await one(db, 'SELECT * FROM node_active_exams WHERE user_id=? FOR UPDATE', [userId]);
      return work(db, user, row);
    });
  }
  async insert(db, userId, sessionId, exam) {
    await db.execute('INSERT INTO node_active_exams (user_id,nonce,session_id,exam,answers,page_token,last_seen_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE nonce=VALUES(nonce),session_id=VALUES(session_id),exam=VALUES(exam),answers=VALUES(answers),page_token=VALUES(page_token),last_seen_at=VALUES(last_seen_at),sequence=0,visibility=\'visible\',left_at=NULL,result=NULL',
      [userId, exam.nonce, sessionId, JSON.stringify(exam), '{}', randomBytes(16).toString('hex'), this.clock()]);
  }
  due(row) {
    const time = this.clock();
    if (row.left_at !== null && Number(row.left_at) + LEAVE_GRACE <= time) return { reason: 'leave', time: Number(row.left_at) };
    if (row.left_at === null && row.visibility === 'visible' && Number(row.last_seen_at) + LOST_CONNECTION_GRACE <= time)
      return { reason: 'disconnect', time: Number(row.last_seen_at) };
    return null;
  }
  async sessionExpired(db, row) {
    const session = await one(db, 'SELECT data,expires_at FROM node_sessions WHERE id=?', [row.session_id]);
    if (!session || Number(session.expires_at) <= this.clock()) return true;
    return Number(decode(session.data).userId) !== row.user_id;
  }
  async finish(db, user, row, reason, at = this.clock(), input = null) {
    if (!unfinished(row)) return row ? decode(row.result) : null;
    const exam = decode(row.exam), answers = decode(row.answers);
    if (input) Object.assign(answers, this.readAnswers(input, exam.snapshot.questions.length, false));
    const result = await this.exams.grade(user, exam, answers, db, Math.max(exam.started_at, at));
    result.reason = reason;
    result.mode = exam.mode;
    await db.execute('UPDATE node_active_exams SET exam=?,answers=?,result=? WHERE user_id=? AND nonce=?',
      [JSON.stringify({mode:exam.mode,source:exam.source,nonce:exam.nonce,started_at:exam.started_at}), '{}', JSON.stringify(result), user.identity, row.nonce]);
    row.result = result;
    return result;
  }
  readAnswers(input, count, full = true) {
    const answers = {};
    for (let i = 1; i <= count; i++) {
      const name = 'Q' + i;
      if (!full && !Object.hasOwn(input, name)) continue;
      const value = input[name] ?? 'N';
      if (![...options, 'N'].includes(value)) fail(400, '作答資料不正確。');
      answers[name] = value;
    }
    return answers;
  }
  async startPrepared(user, sessionId, exam, expectedNonce = undefined) {
    return this.locked(user.identity, async (db, owner, existing) => {
      const row = existing;
      if (expectedNonce !== undefined && (row?.nonce ?? null) !== expectedNonce)
        fail(409, '其他頁面已開始新的測驗，這次 AI 考卷未套用。請回到目前考卷或重新開始。');
      if (unfinished(row)) await this.finish(db, owner, row, 'replaced');
      exam.started_at = this.clock();
      await this.insert(db, owner.identity, sessionId, exam);
      return exam;
    });
  }
  async open(user, sessionId) {
    return this.locked(user.identity, async (db, owner, existing) => {
      const row = existing;
      if (!row) return null;
      if (!unfinished(row)) return { result: decode(row.result) };
      const due = this.due(row);
      if (due) return { result: await this.finish(db, owner, row, due.reason, due.time) };
      const page = randomBytes(16).toString('hex');
      await db.execute('UPDATE node_active_exams SET page_token=?,session_id=?,last_seen_at=?,left_at=NULL,visibility=\'visible\' WHERE user_id=?',
        [page, sessionId, this.clock(), owner.identity]);
      return { exam: decode(row.exam), answers: decode(row.answers), page, sequence: Number(row.sequence) };
    });
  }
  async update(user, input, action) {
    if (!['save','depart','abandon'].includes(action)) throw new Error('Invalid exam action');
    return this.locked(user.identity, async (db, owner, row) => {
      if (!row || !safeEqual(row.nonce, input._exam)) fail(409, '此份考卷已失效，請重新載入。');
      if (!unfinished(row)) return { result: decode(row.result) };
      if (!safeEqual(row.page_token, input._page)) fail(409, '考卷已在其他頁面開啟，請重新載入。');
      const due = this.due(row);
      if (due) return { result: await this.finish(db, owner, row, due.reason, due.time) };
      const sequence = Number(input._sequence);
      if (!Number.isSafeInteger(sequence) || sequence < 0) fail(400, '作答版本不正確。');
      if (!['visible','hidden'].includes(input.visibility)) fail(400, '頁面狀態不正確。');
      const answers = this.readAnswers(input, decode(row.exam).snapshot.questions.length);
      const newer = sequence > Number(row.sequence);
      if (newer) {
        await db.execute('UPDATE node_active_exams SET answers=?,sequence=?,visibility=?,last_seen_at=? WHERE user_id=?',
          [JSON.stringify(answers), sequence, input.visibility, this.clock(), owner.identity]);
        row.answers = answers; row.sequence = sequence;
      }
      if (action === 'depart' && newer) {
        // Only opening the paper again can cancel departure. A late autosave cannot.
        await db.execute('UPDATE node_active_exams SET left_at=COALESCE(left_at,?) WHERE user_id=?', [this.clock(), owner.identity]);
      }
      if (action === 'abandon') return { result: await this.finish(db, owner, row, 'leave') };
      return { saved: true };
    });
  }
  async submit(user, input) {
    return this.locked(user.identity, async (db, owner, existing) => {
      const row = existing;
      if (!unfinished(row) || !safeEqual(row.nonce, input._exam)) fail(409, '測驗已繳交或此份考卷已失效，請重新開始。');
      if (input._page && !safeEqual(row.page_token, input._page)) fail(409, '考卷已在其他頁面開啟，請重新載入。');
      const due = this.due(row);
      if (due) return this.finish(db, owner, row, due.reason, due.time);
      return this.finish(db, owner, row, 'manual', this.clock(), input);
    });
  }
  async abandon(user, reason = 'logout') {
    return this.locked(user.identity, async (db, owner, existing) => {
      const row = existing;
      return unfinished(row) ? this.finish(db, owner, row, reason) : null;
    });
  }
  async sweep() {
    const time = this.clock();
    const [candidates] = await this.pool.execute('SELECT a.user_id FROM node_active_exams a LEFT JOIN node_sessions s ON s.id=a.session_id WHERE a.result IS NULL AND ((a.left_at IS NOT NULL AND a.left_at<=?) OR (a.left_at IS NULL AND a.visibility=\'visible\' AND a.last_seen_at<=?) OR s.id IS NULL OR s.expires_at<=? OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.data,\'$.userId\')),\'\')<>CAST(a.user_id AS CHAR)) ORDER BY a.user_id LIMIT 100',
      [time - LEAVE_GRACE, time - LOST_CONNECTION_GRACE, time]);
    for (const { user_id: userId } of candidates) {
      try {
        await this.locked(userId, async (db, owner, row) => {
          if (!unfinished(row)) return;
          const due = this.due(row);
          if (due) await this.finish(db, owner, row, due.reason, due.time);
          else if (await this.sessionExpired(db, row)) await this.finish(db, owner, row, 'session_expired', Number(row.last_seen_at));
        });
      } catch (error) { if (error.status !== 401) throw error; }
    }
    return candidates.length;
  }
}
