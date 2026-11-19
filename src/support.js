import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './paths.js';

export const options = ['A', 'B', 'C', 'D'];
export const formatScore = value => Number(value).toFixed(2);
export const now = () => Math.floor(Date.now() / 1000);
export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function integer(value, fallback = null) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))) return fallback;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : fallback;
}
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}
export function formatDate(timestamp = now()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .format(new Date(timestamp * 1000)).replaceAll('-', '/');
}
export const identity = id => '#' + String(id).padStart(4, '0');
export const roleName = user => ['學生', '教師', '管理者'][user?.role] ?? '未授權角色';
export const hasRole = (user, minimum) => !!user && [0, 1, 2].includes(user.role) && user.role >= minimum;
export function avatar(user) {
  if (user && /^[a-zA-Z][a-zA-Z0-9_]{5,29}$/.test(user.username) &&
    fs.existsSync(path.join(root, 'public/images/avatar', user.username + '.png'))) {
    return '/images/avatar/' + encodeURIComponent(user.username) + '.png';
  }
  return '/images/default_avatar.png';
}
export function feedback(score) {
  if (score === 100) return '全部答對，繼續保持！';
  if (score >= 80) return '表現不錯，再複習錯題會更穩定。';
  if (score >= 60) return '已達分數門檻，繼續加強不熟悉的題型。';
  return '多利用練習與考後檢討，逐步掌握各類題型。';
}
export function lastSeen(value) {
  if (value < 0) return '未曾上線';
  const minutes = Math.max(0, Math.floor((now() - value) / 60));
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return minutes + ' 分鐘前';
  if (minutes < 1440) return Math.floor(minutes / 60) + ' 小時前';
  return Math.floor(minutes / 1440) + ' 天前';
}
export function pager(total, perPage, current, pathname, query = {}) {
  const last = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(last, Math.max(1, integer(current, 1)));
  const numbers = [...new Set([1, ...Array.from({ length: Math.min(last, page + 2) - Math.max(1, page - 2) + 1 },
    (_, i) => Math.max(1, page - 2) + i), last])];
  return { total, perPage, page, last, numbers, url: (number, hash = 'pagination') =>
    pathname + '?' + new URLSearchParams({ ...query, page: number }) + '#' + hash };
}
