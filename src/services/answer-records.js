import {options,fail} from '../support.js';

   function readAnswerReferences(value){
     let data=value;
     try{if(typeof data==='string')data=JSON.parse(data);}catch{fail(409,'測驗紀錄格式無法讀取。');}
     if(!data||data.version!==2||!Array.isArray(data.questions)||!data.questions.length||data.questions.length>50||
       Object.keys(data).some(key=>!['version','questions'].includes(key))||
       !data.questions.every(q=>q&&Number.isSafeInteger(q.question_id)&&q.question_id>0&&
         (q.selected_answer===null||options.includes(q.selected_answer))&&
         Object.keys(q).length===2&&Object.keys(q).every(key=>['question_id','selected_answer'].includes(key)))||
       new Set(data.questions.map(q=>q.question_id)).size!==data.questions.length)fail(409,'測驗紀錄格式無法讀取。');
     return data;
   }

export {readAnswerReferences};
