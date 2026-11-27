// Real PostgreSQL, separate connections (CI's disposable database; run after safety4-postgres.cjs).
// Work 8th reproductions under real concurrency:
//  C) a sender that took the notice fence and then stalls for ever (a hung provider call that ignores
//     every abort) used to make a leave wait for ever. The database now ends that transaction itself
//     (idle-in-transaction / statement / lock timeouts set by the fence): the leave completes within ~10 s,
//     the notice stays in doubt and is never sent twice.
const {Pool}=require('pg');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const url=process.env.ATOKORE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/atokore_ci'||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Use an isolated localhost atokore_ci database');
const pool=new Pool({connectionString:url,max:12});
pool.on('error',()=>{});   // an idle client ended by the server (the stalled sender below) is expected
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(uid,sql,params=[]){
 const c=await pool.connect();
 try{await c.query('begin');await c.query('set local role authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[uid]);const r=await c.query(sql,params);await c.query('commit');return r.rows[0].r}
 catch(e){await c.query('rollback').catch(()=>{});throw e}finally{c.release()}
}
async function svc(fn,args=[]){
 const c=await pool.connect();
 try{await c.query('begin');await c.query('set local role service_role');const r=await c.query('SELECT atokore_private.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args);await c.query('commit');return r.rows[0].r}
 catch(e){await c.query('rollback').catch(()=>{});throw e}finally{c.release()}
}
const push=(uid,ops)=>rpc(uid,'SELECT public.hh_push($1::jsonb) r',[JSON.stringify(ops)]);
async function household(name){
 const A=randomUUID(),B=randomUUID();
 const hh=(await rpc(A,"SELECT public.hh_create($1,'QA-A') r",[name])).household.id;
 const code=(await rpc(A,'SELECT public.hh_invite_create() r')).code;
 await rpc(B,"SELECT public.hh_join($1,'QA-B') r",[code]);
 await pool.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) VALUES($1,'QA safety5') ON CONFLICT DO NOTHING",[hh]);
 return {A,B,hh};
}

async function stalledSender(){
 const {A,B}=await household('QA safety5 stall');
 await push(A,[{op_id:randomUUID(),type:'create',kind:'buy',id:'buy_s5_stall',qty:1,fields:{name:'合成',unit:'本'},ts:Date.now()}]);
 await rpc(A,'SELECT public.hh_buy_assign($1,$2::uuid,0) r',['buy_s5_stall',B]);
 const [c]=(await svc('notify_claim_v51',[50,120])).filter(x=>x.recipient===B);
 assert.equal((await svc('notify_authorize_v51',[c.id,c.token])).ok,true);
 // The sender's transaction takes the fence ... and then never says anything again (stalled for ever).
 const sender=new (require('pg').Client)({connectionString:url});
 sender.on('error',()=>{});
 await sender.connect();
 await sender.query('begin');await sender.query('set local role service_role');
 assert.equal((await sender.query('SELECT atokore_private.notify_fence_v51($1,$2) r',[c.id,c.token])).rows[0].r.ok,true);
 const t0=Date.now();
 const left=await Promise.race([rpc(B,'SELECT public.hh_leave() r').then(()=>'left'),delay(15000).then(()=>'still waiting after 15 s')]);
 const ms=Date.now()-t0;
 assert.equal(left,'left','the leave must not wait for a stalled sender');
 assert.ok(ms<=10500,'the leave completed within ~10 s (took '+ms+' ms)');
 console.log('PASS C: a stalled sender (fence held, no answer, no abort) delays a leave by '+ms+' ms, not for ever');
 // The stalled sender's connection was ended by the database; its transaction rolled back.
 await assert.rejects(sender.query('SELECT 1'));
 await sender.end().catch(()=>{});
 const row=(await pool.query('SELECT send_started_at IS NOT NULL started,sent_at IS NULL unsent,ambiguous_at FROM atokore_private.notify_outbox WHERE id=$1',[c.id])).rows[0];
 assert.deepEqual([row.started,row.unsent],[true,true],'the notice is in doubt (authorized, not known as sent)');
 // Taken again after the lease: in doubt, and the member has left -> never sent (dropped or held).
 await pool.query("UPDATE atokore_private.notify_outbox SET lease_until=now()-interval '1 second' WHERE id=$1",[c.id]);
 const again=(await svc('notify_claim_v51',[50,120])).filter(x=>x.id===c.id);
 assert.ok(again.length===0||again[0].in_doubt===true,'never offered as a fresh send');
 if(again.length){const f=await svc('notify_fence_v51',[again[0].id,again[0].token]);assert.equal(f.ok,false,'the member has left: no send')}
 console.log('PASS C: after the stall the notice is in doubt and is not sent to the member who left');
}
// Forecast (Work 8th): an undo and a stale write-back of the same entry from two connections at once never
// leave the entry counted; buying the same row again afterwards is a new purchase whose entry counts.
async function forecastOwnership(){
 const {A,hh}=await household('QA safety5 forecast');
 const item='item-s5-'+randomUUID().slice(0,8),buy='buy-s5-'+randomUUID().slice(0,8);
 await push(A,[{op_id:randomUUID(),type:'create',kind:'item',id:item,qty:1,fields:{name:'合成 おむつ',unit:'袋'},ts:Date.now()},{op_id:randomUUID(),type:'create',kind:'buy',id:buy,qty:1,fields:{name:'合成 おむつ',unit:'袋'},ts:Date.now()}]);
 const cmd=(ops,rc)=>rpc(A,'SELECT public.hh_push_v51($1::jsonb,$2::jsonb) r',[JSON.stringify(ops),JSON.stringify(rc)]);
 // Work 9th: the entry belongs to the purchase's op id (key 'op:'+id), not to the shopping row.
 const entry=o=>({v:1,k:'op:'+o,o,q:1,u:60,d:'2026-11-27',t:Date.now()}),fld=o=>'tp'+o.replace(/-/g,'').slice(-12);
 const p1=randomUUID();
 await cmd([{op_id:p1,type:'complete_buy',buy,item,delta:1,ts:Date.now()},{op_id:randomUUID(),type:'set',kind:'item',id:item,field:fld(p1),value:entry(p1)}],[p1]);
 const rec=async()=>(await pool.query('SELECT qty::int q,fields FROM atokore_private.records WHERE household_id=$1 AND id=$2',[hh,item])).rows[0];
 const [u]=await Promise.all([
  rpc(A,'SELECT public.hh_undo_purchases_v51($1::jsonb) r',[JSON.stringify([p1])]),
  push(A,[{op_id:randomUUID(),type:'set',kind:'item',id:item,field:fld(p1),value:{...entry(p1),t:Date.now()+1}}]),
 ]);
 assert.equal(u.undone,1);
 let r=await rec();
 assert.equal(r.q,1);
 assert.equal(r.fields[fld(p1)],undefined,'the undone entry is not counted, whichever committed first');
 const p2=randomUUID();
 await cmd([{op_id:randomUUID(),type:'set',kind:'item',id:item,field:fld(p2),value:entry(p2)},{op_id:p2,type:'complete_buy',buy,item,delta:1,ts:Date.now()}],[p2]);
 await push(A,[{op_id:randomUUID(),type:'set',kind:'item',id:item,field:fld(p1),value:entry(p1)}]);   // p1 arrives late again
 r=await rec();
 assert.equal(r.q,2);assert.equal(r.fields[fld(p2)]?.o,p2,'the same row bought again: a new op, counted');
 assert.equal(r.fields[fld(p1)],undefined,'the old op never comes back');
 console.log('PASS forecast: an undo and a stale write-back at once leave nothing counted; buying the row again counts once (its own op)');
}
async function main(){
 await stalledSender();
 if(!(await pool.query("SELECT to_regprocedure('public.hh_push_v51(jsonb,jsonb,text)') IS NOT NULL ok")).rows[0].ok)
  await pool.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../supabase/proposals/atokore-purchase-undo-window-v51.sql'),'utf8'));
 await forecastOwnership();
}
main().then(()=>pool.end(),e=>{console.error(e);pool.end();process.exit(1)});
