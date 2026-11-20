import {transaction,one} from '../db.js';
import {integer,fail,pager} from '../support.js';
import {questionBanks} from '../services/question-banks.js';
import {validateQuestion} from '../middleware.js';
export function managementController(pool,questions){
  const statuses={approved:'可出題',pending:'待檢核',rejected:'已停用'};
  const idOf=req=>{const id=integer(req.params.id);if(!id)fail(404,'題目不存在。');return id;};
  const destination=q=>'/questions?bank='+q.bank_code+'&status='+q.review_status;
  return {
    index:async(req,res)=>{
      const bankId=integer(req.query.bank??0),bank=questionBanks.find(q=>q.code===bankId);
      if(!bank)fail(404,'題庫不存在。');
      const status=req.query.status??'approved';
      if(status!=='all'&&!Object.hasOwn(statuses,status))fail(422,'檢核狀態不正確。');
      const summary=await one(pool,"SELECT COUNT(*) AS total,COALESCE(SUM(review_status='approved'),0) AS approved,COALESCE(SUM(review_status='pending'),0) AS pending,COALESCE(SUM(review_status='rejected'),0) AS rejected FROM questions WHERE bank_code=?",[bankId]);
      const pages=pager(Number(status==='all'?summary.total:summary[status]),10,req.query.page,'/questions',{bank:bankId,status});
      const [items]=await pool.query('SELECT * FROM questions WHERE bank_code=?'+(status==='all'?'':' AND review_status=?')+' ORDER BY id DESC LIMIT 10 OFFSET ?',
        status==='all'?[bankId,(pages.page-1)*10]:[bankId,status,(pages.page-1)*10]);
      return res.page('questions/index',{title:'題庫管理',bankId,bank,questionBanks,status,statuses,summary,items,pager:pages});
    },
    store:async(req,res)=>{
      const data=validateQuestion(req.body),id=await questions.create(data);
      req.session.status='題目已新增，ID：'+id+'。';res.redirect(destination(data));
    },
    update:async(req,res)=>{
      const data=validateQuestion(req.body),result=await questions.update(idOf(req),data);
      req.session.status=result.versioned?'已建立新版本，題目 ID：'+result.id+'。原版本已停用，既有檢討保留原內容。':'檢核狀態已更新。';
      res.redirect(destination(data));
    },
    destroy:async(req,res)=>{
      const id=idOf(req),row=await questions.find(id);if(!row)fail(404,'題目不存在。');
      await questions.disable(id);
      req.session.status='題目已停用；既有作答與檢討仍可讀取。';res.redirect('/questions?bank='+row.bank_code+'&status=rejected');
    },
    access: async (req, res) => {
      const id = integer(req.body.identity), changeRole = Object.hasOwn(req.query, 'change_role'), remove = Object.hasOwn(req.query, 'delete');
      if (!id || changeRole === remove) fail(400, '請選擇有效會員操作。');
      const role = integer(req.body.role);
      if (changeRole && ![0, 1, 2].includes(role)) fail(422, '角色不正確。');
      if (remove && req.body.role !== undefined) fail(422, '刪除操作不接受角色欄位。');
      await transaction(pool, async db => {
        const target = await one(db, 'SELECT * FROM user WHERE identity=? FOR UPDATE', [id]);
        if (!target) fail(404, '會員不存在。');
        if (id === req.user.identity) fail(403, '無法變更自己的角色或刪除自己。');
        if (changeRole) await db.execute('UPDATE user SET role=? WHERE identity=?', [role, id]);
        else {
          if (target.role !== 0) fail(403, '僅能刪除其他學生帳號。');
          await db.execute('DELETE FROM user WHERE identity=?', [id]);
        }
      });
      req.session.status = '會員權限已更新。'; res.redirect('/members');
    },
  };
}
