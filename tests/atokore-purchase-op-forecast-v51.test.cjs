// Work 9th (②, ④). Isolated PGlite only.
//  ④ the dedicated purchase command checks its input strictly BEFORE anything is applied: NULL, empty, other
//    types, malformed UUIDs, duplicates, unlisted ops, ops of another person or household and mixtures refuse
//    the WHOLE call (no purchase, stock, shopping, receipt or forecast change); receipts only on a positive match.
//  ② a forecast entry belongs to the immutable op id of its purchase ("o", key 'op:'+o). Re-buying the same
//    shopping row is a new op with its own entry; a late entry of an undone op never becomes valid; nothing is
//    re-attributed by the row; the forecast part keeps working through an E rollback and a re-apply.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {createDb,call}=require('./household/pg.cjs');
const P=f=>fs.readFileSync(path.join(__dirname,'../supabase/proposals',f),'utf8');
const A='00000000-0000-4000-8000-0000000009a1',B='00000000-0000-4000-8000-0000000009b1',R='00000000-0000-4000-8000-0000000009e1';
let n=0;const oid=()=>'60000000-0000-4000-8000-'+String(++n).padStart(12,'0');
async function fixture(){
 const db=await createDb();await db.exec(P('atokore-purchase-undo-window-v51.sql'));
 const h=(await call(db,A,'hh_create',{p_name:'QA op forecast',p_display_name:'A'})).household.id;
 const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
 await call(db,R,'hh_create',{p_name:'QA other household',p_display_name:'R'});
 await db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) VALUES($1,'QA op forecast')",[h]);
 await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'create',kind:'item',id:'item-opf-1',qty:1,fields:{name:'合成 おむつ',unit:'袋'}},
  {op_id:oid(),type:'create',kind:'buy',id:'buy-opf-1',qty:2,fields:{name:'合成 おむつ',unit:'袋'}}]});
 return {db,h};
}
const rec=async(db,id)=>(await db.query("SELECT qty::int q,deleted,fields FROM atokore_private.records WHERE id=$1",[id])).rows[0];
const ops=async db=>(await db.query('SELECT count(*)::int c FROM atokore_private.ops')).rows[0].c;
const receipts=async db=>(await db.query('SELECT count(*)::int c FROM atokore_private.purchase_receipts_v51')).rows[0].c;
const quarantine=async(db,reason)=>(await db.query('SELECT count(*)::int c FROM atokore_private.purchase_forecast_quarantine_v51 WHERE reason=$1',[reason])).rows[0].c;
const buyOp=(id=oid(),buy='buy-opf-1')=>({op_id:id,type:'complete_buy',buy,item:'item-opf-1',delta:2,ts:Date.now()});
const entry=(o,extra={})=>({v:1,k:'op:'+o,o,q:2,u:60,d:'2026-11-27',t:Date.now(),...extra});
const field=o=>'tp'+o.replace(/-/g,'').slice(-12);
const setEntry=(o,value=entry(o))=>({op_id:oid(),type:'set',kind:'item',id:'item-opf-1',field:field(o),value});
const asUser=(db,uid,fn,arg)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);return (await tx.query('select public.'+fn+'($1::jsonb) r',[JSON.stringify(arg)])).rows[0].r});
// Raw call so that SQL NULL / JSON null / wrong types reach the function exactly as given.
const raw=(db,uid,opsJson,rcJson)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);
 return (await tx.query('select public.hh_push_v51($1::jsonb,$2::jsonb) r',[opsJson,rcJson])).rows[0].r});

test('④ (Work 9th): every invalid dedicated input refuses the whole call — no purchase, stock, shopping, receipt or forecast change',async()=>{
 const {db}=await fixture();
 try{
  const other=oid();
  await call(db,R,'hh_push',{p_ops:[{op_id:other,type:'create',kind:'item',id:'item-r-1',qty:1,fields:{name:'x',unit:'個'}}]});   // an op id of another household
  const ofB=oid();await call(db,B,'hh_push',{p_ops:[{op_id:ofB,type:'create',kind:'item',id:'item-b-1',qty:1,fields:{name:'y',unit:'個'}}]});
  const before={ops:await ops(db),receipts:await receipts(db),item:await rec(db,'item-opf-1'),buy:await rec(db,'buy-opf-1')};
  const p=buyOp(),cases=[
   ['SQL NULL list',JSON.stringify([p,setEntry(p.op_id)]),null],
   ['JSON null list',JSON.stringify([p]),'null'],
   ['empty list',JSON.stringify([p]),'[]'],
   ['an object, not a list',JSON.stringify([p]),JSON.stringify({id:p.op_id})],
   ['a NULL element',JSON.stringify([p]),'[null]'],
   ['a NULL element mixed with the valid id',JSON.stringify([p]),JSON.stringify([p.op_id,null])],
   ['a number',JSON.stringify([p]),'[123]'],
   ['a malformed UUID',JSON.stringify([p]),JSON.stringify(['not-a-uuid'])],
   ['a UUID with extra text',JSON.stringify([p]),JSON.stringify([p.op_id+' '])],
   ['a duplicate',JSON.stringify([p]),JSON.stringify([p.op_id,p.op_id.toUpperCase()])],
   ['an op not in this call',JSON.stringify([p]),JSON.stringify([p.op_id,oid()])],
   ['a listed op that is not a purchase',JSON.stringify([p,{op_id:'60000000-0000-4000-8000-0000000fffff',type:'add',kind:'item',id:'item-opf-1',delta:1}]),JSON.stringify([p.op_id,'60000000-0000-4000-8000-0000000fffff'])],
   ['an op id of another household',JSON.stringify([p,{...buyOp(other)}]),JSON.stringify([p.op_id,other])],
   ['an op id of another person',JSON.stringify([p,{...buyOp(ofB)}]),JSON.stringify([p.op_id,ofB])],
   ['no ops',JSON.stringify([]),JSON.stringify([p.op_id])],
   ['ops not a list',JSON.stringify(p),JSON.stringify([p.op_id])],
   ['a non-object op',JSON.stringify([p,'x']),JSON.stringify([p.op_id])],
  ];
  for(const [why,o,r] of cases){
   await assert.rejects(raw(db,A,o,r),/purchase_receipt_input_invalid/,why);
   assert.deepEqual({ops:await ops(db),receipts:await receipts(db),item:await rec(db,'item-opf-1'),buy:await rec(db,'buy-opf-1')},before,why+': nothing changed');
  }
  // The valid call (UUID in capitals is the same id) gives exactly one receipt.
  const r=await raw(db,A,JSON.stringify([p,setEntry(p.op_id)]),JSON.stringify([p.op_id.toUpperCase()]));
  assert.deepEqual([r.status,r.receipts],['ready',[p.op_id]]);
  // A resend: no new receipt, the receive time is unchanged.
  const t0=(await db.query('SELECT received_at FROM atokore_private.purchase_receipts_v51 WHERE op_id=$1',[p.op_id])).rows[0].received_at;
  const again=await raw(db,A,JSON.stringify([p]),JSON.stringify([p.op_id]));
  assert.deepEqual(again.receipts,[]);
  assert.deepEqual((await db.query('SELECT received_at FROM atokore_private.purchase_receipts_v51 WHERE op_id=$1',[p.op_id])).rows[0].received_at,t0);
  // The probe answers without applying anything; outside the trial: not_enabled.
  assert.deepEqual(await call(db,A,'hh_purchase_receipts_status_v51',{}),{status:'ready'});
  assert.deepEqual(await call(db,R,'hh_purchase_receipts_status_v51',{}),{status:'not_enabled'});
 }finally{await db.close()}
});
test('② (Work 9th): buy A, undo A, buy the same row as B, then A\'s entry arrives late -> A stays invalid, only B counts; undoing B changes only B',async()=>{
 const {db}=await fixture();
 try{
  const a=oid();
  await call(db,A,'hh_push_v51',{p_ops:[buyOp(a),setEntry(a)],p_receipt_ops:[a]});
  assert.equal((await rec(db,'item-opf-1')).fields[field(a)]?.o,a);
  assert.equal((await asUser(db,A,'hh_undo_purchases_v51',[a])).undone,1);
  assert.equal((await rec(db,'item-opf-1')).fields[field(a)],undefined,'A removed with its undo');
  // B buys the same shopping row (it came back with the undo): a new op, its own entry (set first, then the op).
  const b=oid();
  const rb=await call(db,B,'hh_push_v51',{p_ops:[setEntry(b),buyOp(b)],p_receipt_ops:[b]});
  assert.deepEqual(rb.results.map(x=>x.status),['applied','applied']);
  // A's entry arrives late (stale tab / old phone), before and after B: never valid again.
  await call(db,A,'hh_push',{p_ops:[setEntry(a)]});
  let f=(await rec(db,'item-opf-1')).fields;
  assert.equal(f[field(a)],undefined,'A stays invalid');
  assert.equal(f[field(b)]?.o,b,'B counts (re-adopted only because B itself was applied)');
  assert.equal(await quarantine(db,'undone')>=1,true,'A held, not lost');
  // Ownership cannot be changed: B's field rewritten with A's op is refused, B stays.
  await call(db,A,'hh_push',{p_ops:[setEntry(b,{...entry(b),o:a})]});
  assert.equal((await rec(db,'item-opf-1')).fields[field(b)]?.o,b);
  assert.equal((await asUser(db,B,'hh_undo_purchases_v51',[b])).undone,1);
  f=(await rec(db,'item-opf-1')).fields;
  assert.equal(f[field(b)],undefined);assert.equal(f[field(a)],undefined,'undoing B changes only B');
  assert.equal((await rec(db,'item-opf-1')).q,1,'1 + 2 - 2 + 2 - 2');
 }finally{await db.close()}
});
test('② (Work 9th): entries of another op, product, household or an unknown owner never count; a second phone on the same row does not double count',async()=>{
 const {db}=await fixture();
 try{
  const a=oid(),ghost=oid();
  await call(db,A,'hh_push_v51',{p_ops:[buyOp(a)],p_receipt_ops:[a]});
  await call(db,A,'hh_push',{p_ops:[
   setEntry(ghost),                                                     // an op that does not exist here (e.g. another household's)
   setEntry(a,{...entry(a),k:'op:other'}),                              // key not bound to the op
   {op_id:oid(),type:'set',kind:'item',id:'item-opf-1',field:'tpold1',value:{v:1,k:'sb:row',q:2,d:'2026-11-27',t:1,sb:['buy-opf-1']}}]});   // old client, no o
  const f=(await rec(db,'item-opf-1')).fields;
  assert.deepEqual(Object.keys(f).filter(k=>/^tp/.test(k)),[],'none of them counts');
  assert.ok(await quarantine(db,'owner_pending')>=1&&await quarantine(db,'owner_mismatch')>=1&&await quarantine(db,'owner_unknown')>=1);
  // The same row finished on a second phone: the server skips that purchase (skipped_completed); its entry is held.
  const second=oid();
  const r=await call(db,B,'hh_push',{p_ops:[buyOp(second),setEntry(second)]});
  assert.equal(r.results[0].status,'skipped_completed');
  assert.equal((await rec(db,'item-opf-1')).fields[field(second)],undefined,'one purchase in the estimate');
  // A resend of A's own entry changes nothing; it counts once.
  await call(db,A,'hh_push',{p_ops:[setEntry(a),setEntry(a)]});
  assert.equal((await rec(db,'item-opf-1')).fields[field(a)]?.o,a);
 }finally{await db.close()}
});
test('② (Work 9th): during an E rollback a re-purchase is its own op and the undone one stays out; re-applying E keeps all of it',async()=>{
 const {db}=await fixture();
 try{
  const a=oid();
  await call(db,A,'hh_push_v51',{p_ops:[buyOp(a),setEntry(a)],p_receipt_ops:[a]});
  assert.equal((await asUser(db,A,'hh_undo_purchases_v51',[a])).undone,1);
  await db.exec(P('rollback/atokore-purchase-undo-window-v51.rollback.sql'));
  // Re-purchase of the same row through the ordinary sync (the command is gone during the rollback).
  const b=oid();
  await call(db,A,'hh_push',{p_ops:[buyOp(b),setEntry(b)]});
  await call(db,A,'hh_push',{p_ops:[setEntry(a)]});                  // A arrives late during the rollback
  let f=(await rec(db,'item-opf-1')).fields;
  assert.equal(f[field(a)],undefined,'A does not come back during the rollback');
  assert.equal(f[field(b)]?.o,b);
  // The old RPC (no window during the rollback) undoes B: B's entry goes with it (the forecast part stayed).
  assert.equal((await asUser(db,A,'hh_undo_purchases',[b])).undone,1);
  assert.equal((await rec(db,'item-opf-1')).fields[field(b)],undefined);
  await db.exec(P('atokore-purchase-undo-window-v51.sql'));            // re-apply
  await call(db,A,'hh_push',{p_ops:[setEntry(a),setEntry(b)]});
  f=(await rec(db,'item-opf-1')).fields;
  assert.equal(f[field(a)],undefined,'still out after re-applying');assert.equal(f[field(b)],undefined);
  assert.ok((await db.query('SELECT count(*)::int c FROM atokore_private.purchase_undone_entries_v51')).rows[0].c>=2,'undone history kept');
 }finally{await db.close()}
});
test('⑤ (Work 9th): the undo answer carries the changed product and shopping row with their change numbers',async()=>{
 const {db}=await fixture();
 try{
  const a=oid();
  await call(db,A,'hh_push_v51',{p_ops:[buyOp(a)],p_receipt_ops:[a]});
  const r=await asUser(db,A,'hh_undo_purchases_v51',[a]);
  assert.equal(r.undone,1);
  const item=r.records.find(x=>x.kind==='item'),buy=r.records.find(x=>x.kind==='buy');
  assert.deepEqual([Number(item.qty),buy.deleted],[1,false]);
  assert.ok(Number(item.seq)>0&&Number(buy.seq)>0);
 }finally{await db.close()}
});
