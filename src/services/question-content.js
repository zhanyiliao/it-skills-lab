import {createHash} from 'node:crypto';
import {aiBanks} from './ai-banks.js';
import {options,fail} from '../support.js';

   function questionContentHash(q){
     const code=q.bank_code??aiBanks.find(bank=>bank.id===q.bank)?.code;
     if(!Number.isInteger(code)||code<0||code>7)fail(422,'題庫代碼不正確。');
     return createHash('sha256').update(JSON.stringify([code,q.question,...options.map(option=>q.options?.[option]??q[option]),
       q.answer,q.explanation,Number(q.difficulty)])).digest('hex');
   }

export {questionContentHash};
