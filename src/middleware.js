import { randomBytes, createHash } from 'node:crypto';
import { one } from './db.js';
import { hasRole, safeEqual, fail, options, integer } from './support.js';
export const passwordVersion = value => createHash('sha256').update(value).digest('hex');
export const wantsJson = req => req.get('accept')?.includes('application/json');
export function csrf(req, res, next) {
  req.session.csrf ??= randomBytes(32).toString('hex');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    !safeEqual(req.body?._token ?? req.get('x-csrf-token'), req.session.csrf)) return next(Object.assign(new Error('頁面已逾時，請重新載入後再試。'), { status: 419 }));
  res.locals.csrf = req.session.csrf;
  next();
}
export function currentUser(pool) {
  return async (req, res, next) => {
    if (req.session.userId) {
      const user = await one(pool, 'SELECT * FROM user WHERE identity=?', [req.session.userId]);
      if (user && safeEqual(req.session.authVersion, passwordVersion(user.password))) req.user = user;
      else { delete req.session.userId; delete req.session.practice_result; delete req.session.daily_question_feedback; }
    }
    res.locals.user = req.user ?? null;
    next();
  };
}
export function requireRole(minimum) {
  return (req, res, next) => {
    if (!req.user) {
      if (wantsJson(req)) return res.status(401).json({ message: '請先登入。' });
      if (req.method === 'GET') req.session.intended = req.originalUrl;
      return res.redirect('/login');
    }
    if (!hasRole(req.user, minimum)) return next(Object.assign(new Error('你沒有權限使用此功能。'), { status: 403 }));
    next();
  };
}
export const guest = (req, res, next) => req.user ? res.redirect('/account/'+req.user.identity) : next();
export function validatePassword(body) {
  if (typeof body.password !== 'string' || !/^[\x20-\x7e]{8,72}$/.test(body.password)) fail(422, '密碼需為 8–72 個英數字或半形符號。');
  if (body.password !== body.password_confirmation) fail(422, '兩次輸入的密碼不相符。');
}
export function validateQuestion(body){
   const bank=integer(body.bank_code),difficulty=integer(body.difficulty);
   if(bank===null||bank<0||bank>7||difficulty===null||difficulty<1||difficulty>9)fail(422,'請選擇有效題庫及 1～9 級難度。');
   const data={bank_code:bank,difficulty,review_status:body.review_status};
   if(!['pending','approved','rejected'].includes(data.review_status))fail(422,'檢核狀態不正確。');
   for(const name of ['question',...options,'explanation']){
     if(typeof body[name]!=='string')fail(422,'請完整填寫題目、選項與解析。');
     data[name]=body[name].replace(/\r\n?/g,'\n').trim();
     const max=name==='question'?600:name==='explanation'?1000:300;
     if(!data[name]||data[name].length>max)fail(422,'題目、選項或解析的內容長度不正確。');
   }
   if(!options.includes(body.answer)||new Set(options.map(option=>data[option])).size!==4)fail(422,'請選擇有效正解，且四個選項不可重複。');
   data.answer=body.answer;return data;
 }
