import {StatisticsService} from '../services/statistics.js';
import {floatingDifficulty} from '../services/floating-difficulty.js';
import { one } from '../db.js';
import { questionTextHtml } from '../services/exam-paper.js';
import { aiBanks } from '../services/ai-banks.js';
import { wantsJson } from '../middleware.js';
import { scoredUsersSql } from '../services/records.js';
import { integer, fail, options, pager } from '../support.js';
export function pagesController(pool, daily, records) {
  return {
    home: async (req, res) => {
      const question = await daily.today();
      // Only a no-JavaScript POST uses one-time feedback; normal AJAX answers are never saved.
      const result = daily.result(question, req.session.daily_question_feedback, req.user);
      delete req.session.daily_question_feedback;
      const dailyQuestion = question ? { ...question } : null;
      if (dailyQuestion) {
        dailyQuestion.floating_difficulty=floatingDifficulty(question);
        delete dailyQuestion.answer;
        delete dailyQuestion.explanation;
        for (const key of ['question', ...options]) dailyQuestion[key] = questionTextHtml(dailyQuestion[key]);
      }
      return res.page('pages/home', { title: '資訊能力練習室', dailyQuestion, dailyResult: result, aiBanks });
    },
    dailyAnswer: async (req, res) => {
      const body = req.body;
      if (!options.includes(body.choice) || typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
        !integer(body.question_id) || typeof body.signature !== 'string' || !/^[a-f0-9]{64}$/.test(body.signature)) fail(422, '請選擇有效答案，並確認題目資料完整。');
      const question = await daily.today();
      delete req.session.daily_question_feedback;
      if (!daily.matches(question, body)) fail(409, '每日一題已更新，請重新載入後作答。');
      const submission = { date: body.date, question_id: integer(body.question_id),
        signature: body.signature, choice: body.choice, user_id: req.user.identity };
      if (wantsJson(req)) {
        const dailyResult = daily.result(question, submission, req.user);
        return res.json({ answer: dailyResult.answer, html: await res.fragment('partials/daily-result', { dailyResult }) });
      }
      req.session.daily_question_feedback = submission;
      res.redirect(303, '/#daily-question');
    },
    leaderboard: async (req, res) => {
      const type = ['last_score', 'high_score'].includes(req.query.type) ? req.query.type : 'last_score';
      const [members] = await pool.execute(scoredUsersSql + ' ORDER BY ' + type + ' DESC,u.identity LIMIT 10');
      return res.page('pages/leaderboard', { title: '排行榜', type, members, rank: req.user ? await records.rank(req.user, type) : null, me: req.user ? await records.scores(req.user.identity) : null });
    },
    profile: async (req, res) => {
      const id = integer(req.params.id); if (!id) fail(404, '會員不存在。');
      const member = await records.scores(id);
      if (!member) fail(404, '會員不存在。');
      const ownProfile = req.user?.identity === member.identity;
      res.set('Cache-Control', 'private, no-store');
      return res.page('account/profile', { title: '個人主頁', member, ownProfile,
        description:ownProfile?'查看自己的學習成果、成績檢討與帳號設定。':'查看學習成果與測驗排名。', highRank: await records.rank(member, 'high_score'), lastRank: await records.rank(member, 'last_score') });
    },
    members: async (req, res) => {
      const count = await one(pool, 'SELECT COUNT(*) AS total FROM user');
      const pages = pager(count.total, 10, req.query.page, '/members');
      const [members] = await pool.query('SELECT identity,username,role,reg_time,last_login FROM user ORDER BY identity LIMIT ? OFFSET ?', [10, (pages.page - 1) * 10]);
      return res.page('members/index', { title: '會員管理系統', members, pager: pages });
    },
    statistics: async (req,res)=>{
      res.set('Cache-Control','private, no-store');
      const report=await new StatisticsService(pool).report(req.query);
      return res.page('pages/statistics',{title:'使用與題庫概況',...report});
    },
  };
}
