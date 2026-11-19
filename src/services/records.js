import {one} from '../db.js';
import {fail} from '../support.js';
import {recordScoreSql} from './scoring.js';

export const scoredUsersSql='SELECT u.identity,u.username,u.role,u.high_score,'+
  'CAST(COALESCE((SELECT '+recordScoreSql('e')+' FROM exam_records e WHERE e.user_id=u.identity ORDER BY e.submitted_at DESC,e.id DESC LIMIT 1),0) AS DECIMAL(5,2)) AS last_score,'+
  '(SELECT COUNT(*) FROM exam_records e WHERE e.user_id=u.identity) AS exam_count FROM user u';
const recordColumns='e.id,e.user_id,e.started_at,e.submitted_at,e.elapsed_seconds,e.details,e.is_demo,'+recordScoreSql('e')+' AS score';
const scored=record=>record?{...record,score:Number(record.score)}:null;

export class RecordRepository{
  constructor(pool){this.pool=pool;}
  async recent(userId){
    const [rows]=await this.pool.execute('SELECT e.id,e.started_at,e.submitted_at,e.elapsed_seconds,e.is_demo,'+recordScoreSql('e')+' AS score FROM exam_records e WHERE e.user_id=? ORDER BY e.submitted_at DESC,e.id DESC LIMIT 5',[userId]);
    return rows.map(scored);
  }
  async find(userId,id=null){
    const record=await one(this.pool,'SELECT '+recordColumns+' FROM exam_records e WHERE e.user_id=?'+
      (id===null?' ORDER BY e.submitted_at DESC,e.id DESC LIMIT 1':' AND e.id=?'),id===null?[userId]:[userId,id]);
    if(id!==null&&!record)fail(404,'找不到這份測驗紀錄。');
    return scored(record);
  }
  async scores(userId){
    const row=await one(this.pool,scoredUsersSql+' WHERE u.identity=?',[userId]);
    return row?{...row,high_score:Number(row.high_score),last_score:Number(row.last_score)}:null;
  }
  async rank(user,type){
    if(!['high_score','last_score'].includes(type))fail(400,'排行榜類型不正確。');
    const own=await this.scores(user.identity);
    const result=await one(this.pool,'SELECT COUNT(*) AS total FROM ('+scoredUsersSql+') scores WHERE '+
      type+'>? OR ('+type+'=? AND identity<?)',[own[type],own[type],user.identity]);
    return Number(result.total)+1;
  }
}
