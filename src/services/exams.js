import {options,now,fail} from '../support.js';
import {transaction,one} from '../db.js';
import {validateFormalPaper} from './hybrid-exams.js';
import {readAnswerReferences} from './answer-records.js';
import {PRACTICE_REVIEW_TTL} from './practice-review.js';
import {readPaper,paperRows} from './exam-paper.js';
import {weightedScore} from './scoring.js';

export class ExamService {
  constructor(pool, hybrid=null){this.pool=pool;this.hybrid=hybrid;}
  paper(exam){
    if(!exam.snapshot)fail(409,'考卷已失效，請重新開始測驗。');
    return paperRows(exam.snapshot);
  }
  async grade(user,exam,input,connection=null,submittedAt=null){
    const original=readPaper(exam.snapshot);
    if(exam.source==='hybrid'){
      if(!this.hybrid)fail(409,'正式測驗尚未完成設定。');
      validateFormalPaper(exam);
    }else if(exam.source!=='bank'||exam.mode!=='practice'||!Array.isArray(exam.question_ids)||
      exam.question_ids.length!==original.questions.length)fail(409,'考卷資料不正確。');
    const answered={...original,questions:original.questions.map((question,index)=>{
      const choice=input['Q'+(index+1)]??'N';
      if(![...options,'N'].includes(choice))fail(400,'作答資料不正確。');
      return {...question,selected_answer:choice==='N'?null:choice};
    })};
    const grade=async db=>{
      if(!await one(db,'SELECT identity FROM user WHERE identity=? FOR UPDATE',[user.identity]))fail(401,'帳號不存在。');
      try{await db.execute('INSERT INTO node_exam_submissions (nonce,user_id,submitted_at) VALUES (?,?,?)',[exam.nonce,user.identity,now()]);}
      catch(error){if(error.code==='ER_DUP_ENTRY')fail(409,'測驗已繳交，請重新開始。');throw error;}
      const bankedIds=exam.source==='hybrid'?await this.hybrid.commitQuestions(db,exam):null;
      const ids=bankedIds?exam.origins.map(origin=>origin.kind==='bank'?origin.question_id:bankedIds[origin.index]):exam.question_ids;
      const details=readAnswerReferences({version:2,questions:answered.questions.map((q,index)=>({
        question_id:ids[index],selected_answer:q.selected_answer
      }))});
      const submitted=submittedAt??now(),elapsed=Math.max(0,submitted-exam.started_at),score=weightedScore(paperRows(answered));
      let recordId=null;
      if(exam.mode==='formal'){
        const [result]=await db.execute('INSERT INTO exam_records (user_id,started_at,submitted_at,score,elapsed_seconds,details) VALUES (?,?,?,?,?,?)',
          [user.identity,exam.started_at,submitted,score,elapsed,JSON.stringify(details)]);
        recordId=Number(result.insertId);
        await db.execute('UPDATE user SET high_score=GREATEST(high_score,?) WHERE identity=?',[score,user.identity]);
      }
      return {details,score,record_id:recordId,
        expires_at:now()+PRACTICE_REVIEW_TTL};
    };
    return connection?grade(connection):transaction(this.pool,grade);
  }
}
