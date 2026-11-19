import {fail} from '../support.js';

function weightedScore(rows){
  let total=0,earned=0;
  for(const row of rows){
    if(row.missing||!Number.isInteger(row.difficulty)||row.difficulty<1||row.difficulty>9)
      fail(409,'題目難度資料不完整，無法計算成績。');
    total+=row.difficulty;
    if(row.correct)earned+=row.difficulty;
  }
  return total?Math.round(earned*10000/total)/100:0;
}
/** Correlated expression: always calculate history from its immutable question references. */
function recordScoreSql(alias='e'){
  if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias))throw Error('Invalid record alias');
  return `CAST(COALESCE((SELECT ROUND(100.0*SUM(CASE WHEN BINARY r.selected_answer=BINARY q.answer THEN q.difficulty ELSE 0 END)/
    NULLIF(SUM(q.difficulty),0),2)
    FROM JSON_TABLE(${alias}.details,'$.questions[*]' COLUMNS (
      question_id BIGINT PATH '$.question_id',selected_answer CHAR(1) PATH '$.selected_answer' NULL ON EMPTY
    )) AS r JOIN questions q ON q.id=r.question_id),0) AS DECIMAL(5,2))`;
}

export {weightedScore,recordScoreSql};

export function bankPerformance(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.bank_name)) groups.set(row.bank_name, { name: row.bank_name, total: 0, correct: 0 });
    const group = groups.get(row.bank_name);
    group.total++;
    if (row.correct) group.correct++;
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
    .map(group => ({ ...group, rate: Math.round(group.correct / group.total * 10000) / 100 }));
}
