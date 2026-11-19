import {now} from '../support.js';
import {readAnswerReferences} from './answer-records.js';

export const PRACTICE_REVIEW_TTL=60*60;

/** Reading the review entry does not extend its original deadline. */
export function practiceReviewSummary(session,time=now()){
  const result=session?.practice_result;
  if(!result?.details||!Number.isSafeInteger(result.expires_at)||result.expires_at<=time)return null;
  const details=readAnswerReferences(result.details);
  return {title:'練習測驗檢討',amount:details.questions.length,score:result.score,expires_at:result.expires_at};
}
