import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import ejs from 'ejs';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { root } from './paths.js';
import * as support from './support.js';
import { DatabaseSessionStore } from './session-store.js';
import { csrf, currentUser, requireRole, guest, wantsJson } from './middleware.js';
import { QuestionRepository } from './services/questions.js';
import { ExamService } from './services/exams.js';
import { HybridExamService } from './services/hybrid-exams.js';
import { ActiveExamService } from './services/active-exams.js';
import { DailyQuestionService } from './services/daily.js';
import { authController } from './controllers/auth.js';
import { pagesController } from './controllers/pages.js';
import { examsController } from './controllers/exams.js';
import { RecordRepository } from './services/records.js';
import { CodexQuestionGenerator } from './services/ai-questions.js';
import { aiQuestionsController } from './controllers/ai-questions.js';
import { aiBanks, aiAmounts } from './services/ai-banks.js';
import { managementController } from './controllers/management.js';

export function createApp({ pool, secret = config.secret, sessionStore, disableRateLimits = false, questionGenerator = new CodexQuestionGenerator() } = {}) {
  if (!pool) throw new Error('A database pool is required');
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'views'));
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'], upgradeInsecureRequests: null,
  } } }));
  app.use(express.static(path.join(root, 'public'), { dotfiles: 'deny', index: false }));
  app.use(express.urlencoded({ extended: true, limit: '512kb', parameterLimit: 256 }));
  app.use(express.json({ limit: '512kb' }));
  app.use(session({ name: 'itmock.sid', secret, store: sessionStore ?? new DatabaseSessionStore(pool),
    resave: false, saveUninitialized: false, rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.production, maxAge: 7200000 } }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 128, fieldSize: 100000 } });
  app.use((req, res, next) => {
    if (!req.is('multipart/form-data')) return next();
    (req.path === '/settings/avatar' ? upload.single('photo') : upload.none())(req, res, next);
  });
  app.use(csrf);
  app.use((req, res, next) => {
    if (req.method === 'POST' && ['PUT', 'DELETE'].includes(req.body?._method)) req.method = req.body._method;
    next();
  });
  app.use(currentUser(pool));
  const icons = JSON.parse(fs.readFileSync(path.join(root, 'views/icons.json'), 'utf8'));
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'views/page-metadata.json'), 'utf8'));
  const illustration = fs.readFileSync(path.join(root, 'views/partials/study-illustration.ejs'), 'utf8');
  app.use((req, res, next) => {
    Object.assign(res.locals, support, {
      path: req.path, title: '', description: '', eyebrow: 'YOUR LEARNING SPACE',
      ...(metadata[req.path] ?? (req.path.startsWith('/account/') ? metadata.profile : {})),
      status: req.session.status ?? '', pager: null,
      icon: name => '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] ?? icons.info) + '</svg>',
      illustration, assetVersion: fs.statSync(path.join(root, 'public/css/site.css')).mtimeMs,
    });
    delete req.session.status;
    res.fragment = (view, data = {}) => ejs.renderFile(path.join(root, 'views', view + '.ejs'), { ...app.locals, ...res.locals, ...data });
    res.page = async (view, data = {}) => {
      const locals = { ...data };
      locals.body = await res.fragment(view, locals);
      return res.render('layout', locals);
    };
    next();
  });
  const questions = new QuestionRepository(pool), practiceQuestions = questions;
  const hybrid = new HybridExamService(practiceQuestions, questionGenerator);
  const exams = new ExamService(pool, hybrid), records = new RecordRepository(pool);
  const daily = new DailyQuestionService(practiceQuestions, secret);
  const active = new ActiveExamService(pool, exams);
  app.locals.activeExams = active;
  const auth = authController(pool, active), pages = pagesController(pool, daily, records), exam = examsController(exams, records, active, practiceQuestions), management = managementController(pool, questions);
  const authLimit = rateLimit({ windowMs: 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: '嘗試次數過多，請稍後再試。' }, skip: () => disableRateLimits });
  const aiLimit = rateLimit({ windowMs: 600000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: '產生次數較多，請稍後再試。' }, skip: () => disableRateLimits });
  app.post('/exams/formal/start', requireRole(0), aiLimit, aiQuestionsController(active, options => hybrid.prepare(options)));
  app.get('/', pages.home);
  app.get('/about', (req, res) => res.page('pages/about', { title: '關於 IT Skills Lab', aiBanks, aiAmounts }));
  app.get('/leaderboard', pages.leaderboard);
  app.get('/account/:id', pages.profile);
  app.get('/members/:id', (req,res)=>res.redirect(301,'/account/'+encodeURIComponent(req.params.id)));
  app.get('/login', guest, auth.login);
  app.post('/login', guest, authLimit, auth.store);
  app.get('/register', guest, auth.register);
  app.post('/register', guest, authLimit, auth.signup);
  app.post('/daily-question/answer', requireRole(0), pages.dailyAnswer);
  app.get('/account', requireRole(0), (req,res)=>res.set('Cache-Control','no-store').redirect('/account/'+req.user.identity));
  app.get('/logout', requireRole(0), async (req, res) => res.page('auth/logout', { title: '確認登出', hasActiveExam: await active.hasPending(req.user.identity) }));
  app.post('/logout', requireRole(0), auth.logout);
  app.get('/exams', requireRole(0), async (req, res) => res.page('exams/choose', { title: '選擇應試類型', hasActiveExam: await active.hasPending(req.user.identity), aiBanks, aiAmounts }));
  app.post('/exams/practice/start', requireRole(0), exam.startPractice);
  app.get('/exams/current', requireRole(0), exam.show);
  app.post('/exams/submit', requireRole(0), exam.submit);
  app.post('/exams/save', requireRole(0), exam.save);
  app.post('/exams/depart', requireRole(0), exam.depart);
  app.post('/exams/abandon', requireRole(0), exam.abandon);
  app.get('/results/latest', requireRole(0), exam.latest);
  app.get('/results/review', requireRole(0), exam.review);
  app.get('/settings/profile', requireRole(0), (req, res) => res.page('members/settings', { title: '修改密碼與頭像' }));
  app.post('/settings/password', requireRole(0), auth.password);
  app.post('/settings/avatar', requireRole(0), auth.avatar);
  app.get('/questions', requireRole(1), management.index);
  app.post('/questions', requireRole(1), management.store);
  app.put('/questions/:id', requireRole(1), management.update);
  app.delete('/questions/:id', requireRole(1), management.destroy);
  app.get('/members', requireRole(2), pages.members);
  app.post('/members/access', requireRole(2), management.access);
  app.get('/statistics', requireRole(2), pages.statistics);
  app.use((req, res) => { throw Object.assign(new Error('找不到這個頁面。'), { status: 404 }); });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof multer.MulterError ? 422 : error.status ?? (error.code === 'ER_DUP_ENTRY' ? 409 : 500);
    const message = status >= 500 ? '服務暫時無法使用，請稍後再試。' : error.message;
    if (status >= 500) console.error(error);
    if (wantsJson(req)) return res.status(status).json({ message, ...(status === 422 ? { errors: { form: [message] } } : {}) });
    res.status(status);
    if (!res.page) return res.type('text').send(message);
    return res.page('error', { title: String(status), message }).catch(next);
  });
  return app;
}
