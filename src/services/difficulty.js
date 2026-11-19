import { fail } from '../support.js';

export const difficultyMax = 9;
export const difficultyMean = 4;
export const difficultySigma = 1.5;
export const difficultyWeights = Object.freeze(Array.from({ length: difficultyMax }, (_, index) =>
  Math.exp(-((index + 1 - difficultyMean) ** 2) / (2 * difficultySigma ** 2))));
const allLevels = difficultyWeights.map((_, index) => index + 1);

/** Normalize the same normal curve over the levels that currently have questions. */
export function drawDifficulty(random = Math.random, levels = allLevels) {
  if (!levels.length) fail(422, '目前沒有可用難度的題目。');
  const total = levels.reduce((sum, level) => sum + difficultyWeights[level - 1], 0);
  let target = random() * total;
  for (const level of levels) {
    target -= difficultyWeights[level - 1];
    if (target < 0) return level;
  }
  return levels.at(-1);
}

/** Draw a level first, then a question: large levels must not multiply the normal weight. */
export function sampleByDifficulty(rows, amount, random = Math.random) {
  if (!Number.isInteger(amount) || amount < 0 || amount > rows.length) fail(422, '可用題目不足。');
  const groups = new Map();
  for (const row of rows) {
    if (!Number.isInteger(row.difficulty) || row.difficulty < 1 || row.difficulty > difficultyMax)
      fail(409, '題庫難度格式不正確。');
    if (!groups.has(row.difficulty)) groups.set(row.difficulty, []);
    groups.get(row.difficulty).push(row);
  }
  const selected = [];
  while (selected.length < amount) {
    const levels = [...groups.keys()].sort((a,b) => a-b), level = drawDifficulty(random, levels);
    const items = groups.get(level), index = Math.min(items.length - 1, Math.floor(random() * items.length));
    selected.push(items[index]);
    items[index] = items.at(-1); items.pop();
    if (!items.length) groups.delete(level);
  }
  return selected;
}
