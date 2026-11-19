import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadEnvFile } from 'node:process';

import { root, runtime } from './paths.js';
if (existsSync(path.join(root, '.env'))) loadEnvFile(path.join(root, '.env'));
const secretFile = path.join(runtime, 'node-session-secret');
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('Production requires SESSION_SECRET');
  mkdirSync(runtime, { recursive: true });
  if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(48).toString('hex'), { flag: 'wx' });
  return readFileSync(secretFile, 'utf8').trim();
}
export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8080),
  production: process.env.NODE_ENV === 'production',
  secret: secret(),
  codex: { binary: process.env.CODEX_BIN || '', model: process.env.CODEX_MODEL || '',
    timeout: Math.max(1000, Math.min(300000, Number(process.env.CODEX_TIMEOUT_MS) || 180000)) },
  db: { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3307),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD ?? 'password',
    database: process.env.DB_DATABASE || 'php2020', charset: 'utf8mb4',
    connectionLimit: 10, multipleStatements: false },
};
