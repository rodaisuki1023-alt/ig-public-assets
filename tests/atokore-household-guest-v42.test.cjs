const test=require('node:test');
const assert=require('node:assert/strict');
const {createDb,call}=require('./household/pg.cjs');
const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b2',C='00000000-0000-4000-8000-0000000000c3';
test('guest cannot create a household or authorize itself through editable user metadata',async()=>{
 const db=await createDb();
 try{
  await assert.rejects(call(db,B,'hh_create',{p_name:'test',p_display_name:'guest'},{is_anonymous:true,user_metadata:{is_anonymous:false}}),e=>e.code==='42501'&&/permanent_account_required/.test(e.message));
  assert.equal((await db.query('select count(*)::int n from atokore_private.households')).rows[0].n,0);
 }finally{await db.close()}
});
test('guest must redeem an invitation; removal revokes access and a fresh guest can rejoin without losing stock',async()=>{
 const db=await createDb();const guest={is_anonymous:true};
 try{
  await call(db,A,'hh_create',{p_name:'test',p_display_name:'owner'});
  const op={op_id:'00000000-0000-4000-8000-000000000001',type:'create',kind:'item',id:'stock-wipes-test',qty:3,fields:{name:'おしりふき'}};
  await call(db,A,'hh_push',{p_ops:[op]});
  await assert.rejects(call(db,B,'hh_pull',{p_since:0},guest),/not_member/);
  const inv=await call(db,A,'hh_invite_create');
  assert.equal((await call(db,B,'hh_join',{p_code:inv.code,p_display_name:'guest'},guest)).me.role,'member');
  assert.equal(Number((await call(db,B,'hh_pull',{p_since:0},guest)).records[0].qty),3);
  await assert.rejects(call(db,B,'hh_remove_member',{p_user:A},guest),/not_owner/);
  await call(db,A,'hh_remove_member',{p_user:B});
  await assert.rejects(call(db,B,'hh_push',{p_ops:[]},guest),/not_member/);
  const next=await call(db,A,'hh_invite_create');
  await call(db,C,'hh_join',{p_code:next.code,p_display_name:'new phone'},guest);
  assert.equal(Number((await call(db,C,'hh_pull',{p_since:0},guest)).records[0].qty),3);
 }finally{await db.close()}
});
