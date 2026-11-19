import {createHash,randomBytes} from 'node:crypto';
import {transaction,one} from '../db.js';
import {now,options,fail} from '../support.js';
import {PracticeQuestionRepository} from './practice-questions.js';
import {questionContentHash} from './question-content.js';

   class QuestionRepository extends PracticeQuestionRepository{
     find(id,db=this.pool,lock=false){return one(db,'SELECT * FROM questions WHERE id=?'+(lock?' FOR UPDATE':''),[id]);}
     async insertVersion(data,db=this.pool,reuse=false){
       const hash=questionContentHash(data),version=createHash('sha256').update('manual-question-v1').digest('hex');
       try{
         const [result]=await db.execute(`INSERT INTO questions
           (bank_code,question,A,B,C,D,answer,explanation,difficulty,review_status,content_hash,generator,prompt_version,generation_batch,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual',?,?,?)`+(reuse?' ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)':''),
           [data.bank_code,data.question,...options.map(option=>data[option]),data.answer,data.explanation,data.difficulty,data.review_status,
             hash,version,'manual-'+randomBytes(16).toString('hex'),now()]);
         return Number(result.insertId);
       }catch(error){if(error.code==='ER_DUP_ENTRY')fail(409,'相同的題目版本已存在，請直接調整該題的檢核狀態。');throw error;}
     }
     create(data){return this.insertVersion(data);}
     async update(id,data){
       return transaction(this.pool,async db=>{
         const original=await this.find(id,db,true);if(!original)fail(404,'題目不存在。');
         if(questionContentHash(data)===original.content_hash){
           await db.execute('UPDATE questions SET review_status=? WHERE id=?',[data.review_status,id]);
           return {id,versioned:false};
         }
         const nextId=await this.insertVersion(data,db,true);
         await db.execute('UPDATE questions SET review_status=? WHERE id=?',[data.review_status,nextId]);
         if(nextId!==id)await db.execute("UPDATE questions SET review_status='rejected' WHERE id=?",[id]);
         return {id:nextId,versioned:nextId!==id};
       });
     }
     async disable(id){
       const result=await this.pool.execute("UPDATE questions SET review_status='rejected' WHERE id=?",[id]);
       if(!result[0].affectedRows&&!await this.find(id))fail(404,'題目不存在。');
     }
   }

export {QuestionRepository};
