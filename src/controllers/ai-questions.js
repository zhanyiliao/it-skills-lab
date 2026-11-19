import { withSessionLock } from '../session-store.js';
import { fail } from '../support.js';

export function aiQuestionsController(active, preparePaper) {
  return async (req, res, next) => {
    const controller = new AbortController();
    const streaming = req.get('accept')?.includes('application/x-ndjson');
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    let heartbeat;
    res.on('close', disconnected);
    res.set('Cache-Control', 'no-store');
    const event = value => {
      if (controller.signal.aborted || res.destroyed || res.writableEnded) return;
      if (!res.headersSent) {
        res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        heartbeat = setInterval(() => event({ type: 'heartbeat' }), 15000);
        heartbeat.unref();
      }
      res.write(JSON.stringify(value) + '\n');
    };
    try {
      // Generation must not hold the session lock: logout and other tabs stay responsive.
      const expected = await withSessionLock(req, async () => await active.currentNonce(req.user.identity));
      const report = (stage, counts) => { if (streaming) event({ type: 'stage', stage, ...counts }); };
      const paper = await preparePaper({signal:controller.signal,onProgress:report});
      controller.signal.throwIfAborted();
      await withSessionLock(req, async () => {
        if (req.session.userId !== req.user.identity) fail(401, '登入已失效，請重新登入。');
        await active.startPrepared(req.user, req.sessionID, paper, expected);
        delete req.session.practice_result;
      });
      if (!controller.signal.aborted) {
        const result = { destination: '/exams/current' };
        if (streaming) { event({ type: 'result', ...result }); res.end(); }
        else if (req.get('accept')?.includes('application/json')) res.json(result);
        else res.redirect(result.destination);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error.message === 'failed to load session') error = Object.assign(new Error('登入已失效，請重新登入後開始測驗。'), { status: 401 });
      const known = [401, 409, 422, 429, 502, 503, 504].includes(error.status);
      if (streaming && res.headersSent) {
        if (!known) console.error('AI exam generation failed:', error.code ?? error.name);
        event({ type: 'error', message: known ? error.message : 'AI 考卷無法完成，請確認登入狀態後重試。' });
        res.end();
      } else if (known) res.status(error.status).json({ message: error.message });
      else next(error);
    } finally {
      clearInterval(heartbeat);
      res.off('close', disconnected);
    }
  };
}
