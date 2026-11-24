const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{createDb,call}=require('./household/pg.cjs');
test('private photo traffic budget: service-only, authenticated household, daily and monthly bounds',async()=>{
 const db=await createDb(),A=randomUUID(),B=randomUUID(),S=randomUUID(),T=randomUUID();
 try{
  await db.exec('CREATE TABLE auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz)');
  for(const [sid,uid] of [[S,A],[T,B]])await db.query('INSERT INTO auth.sessions VALUES($1,$2,NULL)',[sid,uid]);
  for(const f of ['atokore-photo-reservation-v50.sql','atokore-photo-budget-v50.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/proposals',f),'utf8'));
  const H=(await call(db,A,'hh_create',{p_name:'Budget A',p_display_name:'A'})).household.id;
  const sig='public.hh_photo_budget_service_v50(uuid,uuid,uuid,text)';
  const p=(await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') n,has_function_privilege('authenticated',$1,'EXECUTE') a,has_function_privilege('service_role',$1,'EXECUTE') s",[sig])).rows[0];
  assert.deepEqual(p,{n:false,a:false,s:true});
  const invoke=(uid,sid,op='read')=>db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE service_role');return (await tx.query('SELECT public.hh_photo_budget_service_v50($1,$2,$3,$4) ok',[uid,sid,H,op])).rows[0].ok});
  assert.equal(await invoke(B,T),false);assert.equal(await invoke(A,T),false);assert.equal(await invoke(A,S,'bad'),false);
  assert.equal(await invoke(A,S),true);
  await db.query("UPDATE atokore_private.photo_budget_v50 SET requests=80 WHERE scope='user_day'");
  assert.equal(await invoke(A,S),false);
  await db.query("UPDATE atokore_private.photo_budget_v50 SET requests=1 WHERE scope='user_day'");
  await db.query("UPDATE atokore_private.photo_budget_v50 SET requests=120 WHERE scope='household_day'");
  assert.equal(await invoke(A,S),false);
  await db.query("UPDATE atokore_private.photo_budget_v50 SET requests=1 WHERE scope='household_day'");
  await db.query("UPDATE atokore_private.photo_budget_v50 SET requests=3999,reserved_bytes=1048313856 WHERE scope='global_month'");
  assert.equal(await invoke(A,S),true);assert.equal(await invoke(A,S),false);
  const q=(await db.query("SELECT requests,reserved_bytes FROM atokore_private.photo_budget_v50 WHERE scope='global_month'")).rows[0];
  assert.equal(q.requests,4000);assert.equal(Number(q.reserved_bytes),1048576000);
 }finally{await db.close()}
});
test('denied admission cannot touch storage, decode or lifecycle',async()=>{
 const m=await import('../supabase/proposals/photo-general-v50.mjs');let n=0;
 const h=m.createGeneralPhotoHandler({verify:async()=>({uid:randomUUID(),session:randomUUID()}),admit:async()=>false,
  db:async()=>{n++},normalize:()=>{n++},storage:{upload:async()=>{n++},download:async()=>{n++}}});
 const r=await h({operation:'write',householdId:randomUUID()},'synthetic');
 assert.equal(r.status,429);assert.equal(n,0);
});
