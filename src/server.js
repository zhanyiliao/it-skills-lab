import { createApp } from './app.js';
import { createPool } from './db.js';
import { config } from './config.js';
import { now } from './support.js';
const pool = createPool();
await pool.query('SELECT 1');
const app = createApp({ pool });
await app.locals.activeExams.sweep();
const abandonCleanup = setInterval(() => app.locals.activeExams.sweep().catch(console.error), 10000);
abandonCleanup.unref();
const server = app.listen(config.port, config.host, () => console.log('RUNNING - http://' + config.host + ':' + config.port));
const cleanup = setInterval(() => pool.execute('DELETE FROM node_sessions WHERE expires_at<?', [now()]).catch(console.error), 600000);
cleanup.unref();
let closing = false;
function shutdown() {
  if (closing) return; closing = true;
  clearInterval(cleanup);
  clearInterval(abandonCleanup);
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
