import {floatingDifficulty} from './floating-difficulty.js';
import {weightedScore} from './scoring.js';
import { readAnswerReferences } from './answer-records.js';
import { randomInt } from 'node:crypto';
import { aiBanks, aiSettings, aiDifficultyMax, bankForCode } from './ai-banks.js';
import { sampleByDifficulty } from './difficulty.js';
import {createPaper,questionTextHtml} from './exam-paper.js';
import { options, fail } from '../support.js';

function shuffled(items) {
  const result = [...items];
  for (let i=result.length-1;i>0;i--) { const j=randomInt(i+1); [result[i],result[j]]=[result[j],result[i]]; }
  return result;
}
export class PracticeQuestionRepository {
  constructor(pool) { this.pool=pool; }
  async approvedIds(createdBefore = null) {
    const cutoff = Number.isSafeInteger(createdBefore);
    const [rows]=await this.pool.execute("SELECT id,difficulty FROM questions WHERE review_status='approved'"+
      (cutoff ? " AND (generation_batch NOT LIKE 'formal-%' OR created_at < ?)" : ''),cutoff?[createdBefore]:[]);
    return rows;
  }
  async findApproved(id) {
    const [rows]=await this.pool.execute("SELECT id,bank_code,question,A,B,C,D,answer,explanation,difficulty,appearance_count,correct_count,unanswered_count FROM questions WHERE id=? AND review_status='approved'",[id]);
    return rows[0]??null;
  }
  async approvedRows(codes) {
    const [rows]=await this.pool.execute("SELECT * FROM questions WHERE review_status='approved' AND bank_code IN ("+
      codes.map(()=>'?').join(',')+") ORDER BY id",codes);
    return rows;
  }
  async start(amount, selected) {
    const settings=aiSettings(amount,selected), banks=settings.banks;
    const codes=banks.map(id=>aiBanks.find(bank=>bank.id===id).code);
    const rows=await this.approvedRows(codes);
    const minimum=Math.floor(settings.amount/banks.length), extra=settings.amount%banks.length;
    const groups=new Map(banks.map(bank=>[bank,shuffled(rows.filter(q=>bankForCode(q.bank_code)?.id===bank))]));
    for(const bank of banks)if(groups.get(bank).length<minimum)
      fail(422,aiBanks.find(item=>item.id===bank).name+'的已通過題目不足，請減少題數或調整題庫。');
    const eligible=shuffled(banks.filter(bank=>groups.get(bank).length>minimum));
    if(eligible.length<extra)fail(422,'所選題庫的已通過題目不足，無法平均分配，請調整題數或題庫。');
    const extras=new Set(eligible.slice(0,extra));
    const selectedRows=shuffled(banks.flatMap(bank=>sampleByDifficulty(groups.get(bank),minimum+(extras.has(bank)?1:0))));
    const paper=createPaper(selectedRows.map(q=>({
      bank:bankForCode(q.bank_code).id,question:q.question,options:Object.fromEntries(options.map(option=>[option,q[option]])),
      answer:q.answer,explanation:q.explanation,difficulty:q.difficulty,
    })),settings.amount,banks);
    return {...paper,question_ids:selectedRows.map(q=>Number(q.id))};
  }
  async score(value){return weightedScore(await this.reviewRows(value));}
  async reviewRows(value,{includeFloatingDifficulty=false}={}) {
    const details=readAnswerReferences(value), ids=details.questions.map(q=>q.question_id);
    const [rows]=await this.pool.execute('SELECT * FROM questions WHERE id IN ('+ids.map(()=>'?').join(',')+')',ids);
    const lookup=new Map(rows.map(q=>[Number(q.id),q]));
    return details.questions.map((reference,index)=>{
      const q=lookup.get(reference.question_id), selection=reference.selected_answer??'N';
      if(!q)return {position:index+1,question_id:reference.question_id,selection,bank_name:'無法讀取題目',missing:true,correct:false};
      return {position:index+1,question_id:reference.question_id,bank_name:bankForCode(q.bank_code)?.name??String(q.bank_code),
        question:questionTextHtml(q.question),...Object.fromEntries(options.map(option=>[option,questionTextHtml(q[option])])),
        answer:q.answer,selection,correct:selection===q.answer,difficulty:q.difficulty,difficulty_scale:aiDifficultyMax,explanation:q.explanation,
        ...(includeFloatingDifficulty?{floating_difficulty:floatingDifficulty(q)}:{})};
    });
  }
}
