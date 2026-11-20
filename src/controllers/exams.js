import { integer, fail, pager } from '../support.js';
import { withSessionLock } from '../session-store.js';
import { bankPerformance, weightedScore } from '../services/scoring.js';
import { practiceReviewSummary } from '../services/practice-review.js';

export function examsController(exams, records, active, practiceQuestions) {
  function requestedId(req) {
    if (req.query.record === undefined) return null;
    const id = integer(req.query.record);
    if (!id || id > 4294967295) fail(404, '找不到這份測驗紀錄。');
    return id;
  }
  function remember(req, result) {
    if (result.mode === 'practice') {
      req.session.practice_result = result;
      return '/results/review?mode=practice';
    }
    return '/results/latest?record=' + result.record_id;
  }
  const update = action => async (req, res) => {
    const response = await withSessionLock(req, async () => {
      const value = await active.update(req.user, req.body, action);
      if (value.result) value.destination = remember(req, value.result);
      return value;
    });
    res.json(response.result ? { finished: true, destination: response.destination } : { saved: true });
  };
  return {
    save: update('save'),
    depart: update('depart'),
    abandon: update('abandon'),
    startPractice: async (req, res) => {
      const paper = await practiceQuestions.start(req.body.amount, req.body.banks);
      await withSessionLock(req, async () => {
        if (req.session.userId !== req.user.identity) fail(401, '登入已失效，請重新登入。');
        await active.startPrepared(req.user, req.sessionID, paper);
        delete req.session.practice_result;
      });
      res.redirect('/exams/current');
    },
    show: async (req, res) => {
      const state = await withSessionLock(req, async () => {
        const value = await active.open(req.user, req.sessionID);
        if (value?.result) value.destination = remember(req, value.result);
        return value;
      });
      res.set('Cache-Control', 'no-store');
      if (!state) return res.redirect('/exams');
      if (state.result) return res.redirect(state.destination);
      return res.page('exams/show', { title: '資訊能力檢定模擬測驗', ...state, questions: exams.paper(state.exam) });
    },
    submit: async (req, res) => {
      const destination = await withSessionLock(req, async () => {
        const result = await active.submit(req.user, req.body);
        return remember(req, result);
      });
      res.redirect(destination);
    },
    latest: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const recent = await records.recent(req.user.identity);
      const record = await records.find(req.user.identity, requestedId(req));
      const rows = record ? await practiceQuestions.reviewRows(record.details) : [];
      const practiceReview=practiceReviewSummary(req.session);
      if(practiceReview)practiceReview.score=await practiceQuestions.score(req.session.practice_result.details);
      return res.page('results/latest', { title: '成績與檢討', record, recent, rows, performance: bankPerformance(rows), practiceReview });
    },
    review: async (req, res) => {
      const practice = req.query.mode === 'practice';
      let result, practiceReview = null;
      res.set('Cache-Control', 'no-store');
      if (practice) {
        result = req.session.practice_result;
        practiceReview = practiceReviewSummary(req.session);
        if (!practiceReview) {
          delete req.session.practice_result;
          req.session.status = '練習結果已過期，請重新測驗。';
          return res.redirect('/exams');
        }
      } else result = await records.find(req.user.identity, requestedId(req));
      const rows = result ? await practiceQuestions.reviewRows(result.details,{includeFloatingDifficulty:true}) : [];
      if(practiceReview)practiceReview.score=weightedScore(rows);
      const query = practice ? { mode: 'practice' } : result ? { record: result.id } : {};
      const pages = pager(rows.length, 5, req.query.page, '/results/review', query);
      return res.page('results/review', { title: '測驗結果與考後檢討', rows,
        questions: rows.slice((pages.page - 1) * 5, pages.page * 5), practice, practiceReview, record: practice ? null : result, pager: pages });
    },
  };
}
