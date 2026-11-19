import session from 'express-session';
import { now } from './support.js';

const expiresAt = value => value.cookie?.expires ? Math.floor(new Date(value.cookie.expires).getTime() / 1000) : now() + 7200;

export class DatabaseSessionStore extends session.Store {
  constructor(pool) { super(); this.pool = pool; }
  get(id, callback) {
    this.pool.execute('SELECT data FROM node_sessions WHERE id=? AND expires_at>?', [id, now()])
      .then(([rows]) => callback(null, rows[0] ? JSON.parse(rows[0].data) : null)).catch(callback);
  }
  set(id, value, callback = () => {}) {
    const expires = expiresAt(value);
    this.pool.execute('INSERT INTO node_sessions (id,data,expires_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),expires_at=VALUES(expires_at)',
      [id, JSON.stringify(value), expires]).then(() => callback()).catch(callback);
  }
  destroy(id, callback = () => {}) {
    this.pool.execute('DELETE FROM node_sessions WHERE id=?', [id]).then(() => callback()).catch(callback);
  }
  touch(id, value, callback = () => {}) {
    const expires = expiresAt(value);
    this.pool.execute('UPDATE node_sessions SET expires_at=? WHERE id=?', [expires, id])
      .then(() => callback()).catch(callback);
  }
}
const saveSession = req => new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
export const regenerateSession = req => new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
export const destroySession = req => new Promise((resolve, reject) => req.session.destroy(e => e ? reject(e) : resolve()));

const locks = new Map();
/** Reload after acquiring the lock so simultaneous tabs cannot grade a stale exam twice. */
export async function withSessionLock(req, work) {
  const key = req.sessionID;
  const previous = locks.get(key) ?? Promise.resolve();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => pending);
  locks.set(key, tail);
  await previous;
  try {
    await new Promise((resolve, reject) => req.session.reload(e => e ? reject(e) : resolve()));
    const result = await work();
    await saveSession(req);
    return result;
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}
