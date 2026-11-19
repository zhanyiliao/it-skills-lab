import bcrypt from 'bcryptjs';
import { cropAvatar } from '../services/avatars.js';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { root } from '../paths.js';
import { one } from '../db.js';
import { fail, now } from '../support.js';
import { validatePassword, passwordVersion, wantsJson } from '../middleware.js';
import { regenerateSession, destroySession } from '../session-store.js';
export function authController(pool, active) {
  async function loginUser(req, user, remember) {
    const intended = req.session.intended;
    await active.abandon(user, 'login');
    await regenerateSession(req);
    req.session.userId = user.identity;
    req.session.authVersion = passwordVersion(user.password);
    req.session.cookie.maxAge = remember ? 30 * 86400000 : 2 * 3600000;
    await pool.execute('UPDATE user SET last_login=? WHERE identity=?', [now(), user.identity]);
    return typeof intended === 'string' && intended.startsWith('/') && !intended.startsWith('//') ? intended : '/account/'+user.identity;
  }
  return {
    login: async (req, res) => {
      if (req.query.return === 'daily-question') { req.session.intended = '/#daily-question'; res.locals.status = '請先登入，才能提交每日一題並查看答案。'; }
      return res.page('auth/login', { title: '會員登入' });
    },
    register: (req, res) => res.page('auth/register', { title: '申請帳號' }),
    store: async (req, res) => {
      if (typeof req.body.username !== 'string' || req.body.username.length > 30 || typeof req.body.password !== 'string' || req.body.password.length > 1024) fail(422, '請輸入有效帳號與密碼。');
      const user = await one(pool, 'SELECT * FROM user WHERE username=?', [req.body.username]);
      const hash = user?.password.replace(/^\$2y\$/, '$2b$');
      const valid = await bcrypt.compare(req.body.password, hash ?? '$2b$10$6SE8Io7gtpgs/paqbR4BW.EyV3FX.6scCew0n7C1nc22blMjnAgBy');
      if (!user || !valid) fail(422, '帳號或密碼錯誤。');
      res.redirect(await loginUser(req, user, !!(req.body.remember || req.body.keep_login)));
    },
    signup: async (req, res) => {
      if (typeof req.body.username !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{5,29}$/.test(req.body.username)) fail(422, '帳號需為 6–30 個英數字或底線，並以英文字母開頭。');
      validatePassword(req.body);
      let result;
      const hash = await bcrypt.hash(req.body.password, 12);
      try { [result] = await pool.execute('INSERT INTO user (username,password,role,reg_time,last_login) VALUES (?,?,0,?,?)', [req.body.username, hash, now(), now()]); }
      catch (error) { if (error.code === 'ER_DUP_ENTRY') fail(422, '此帳號已被使用。'); throw error; }
      const user = { identity: result.insertId, password: hash };
      res.redirect(await loginUser(req, user, false));
    },
    logout: async (req, res) => { await active.abandon(req.user); await destroySession(req); res.clearCookie('itmock.sid'); res.redirect('/login'); },
    password: async (req, res) => {
      if (typeof req.body.current_password !== 'string' || req.body.current_password.length > 1024 ||
        !await bcrypt.compare(req.body.current_password, req.user.password.replace(/^\$2y\$/, '$2b$'))) fail(422, '原密碼不正確。');
      validatePassword(req.body);
      await active.abandon(req.user, 'account_change');
      const hash = await bcrypt.hash(req.body.password, 12);
      await pool.execute('UPDATE user SET password=? WHERE identity=?', [hash, req.user.identity]);
      await regenerateSession(req);
      req.session.userId = req.user.identity; req.session.authVersion = passwordVersion(hash);
      req.session.status = '密碼已更新。'; res.redirect('/settings/profile');
    },
    avatar: async (req, res) => {
      if (!req.file || !['image/png', 'image/jpeg', 'image/webp'].includes(req.file.mimetype)) fail(422, '請選擇 PNG、JPEG 或 WebP 圖片。');
      let image;
      try {
        image = await cropAvatar(req.file.buffer, req.body);
      } catch (e) { if (e.status) throw e; fail(422, '圖片無法讀取，請選擇有效圖片。'); }
      if (!/^[a-zA-Z][a-zA-Z0-9_]{5,29}$/.test(req.user.username)) fail(422, '帳號名稱不適用頭像上傳。');
      const directory = path.join(root, 'public/images/avatar');
      await fs.mkdir(directory, { recursive: true });
      const filename = path.join(directory, req.user.username + '.png');
      const temporary = filename + '.' + randomBytes(8).toString('hex') + '.tmp';
      await fs.writeFile(temporary, image);
      await fs.rename(temporary, filename);
      req.session.status = '頭像已更新。';
      if (wantsJson(req)) return res.json({ message: '頭像已更新。' });
      res.redirect('/settings/profile');
    },
  };
}
