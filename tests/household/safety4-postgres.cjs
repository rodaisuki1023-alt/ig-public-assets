// Real PostgreSQL, separate connections (CI's disposable database; run after safety3-postgres.cjs).
// Work 7th fixes under real concurrency:
//  C) the notice fence holds the recipient's membership row: a leave that starts while a notice is being
//     handed to the provider waits for it; a leave committed before the fence -> the provider is not called,
//  A) a pending delete intent: another connection cannot reserve or reference that key meanwhile,
//  E) two connections undo the same ticketed purchase at once (old and new RPC): undone once, its estimate
//     entry removed in that transaction, and a stale write of the entry afterwards does not bring it back.
const {Pool}=require('pg');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const url=process.env.ATOKORE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/atokore_ci'||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Use an isolated localhost atokore_ci database');
const pool=new Pool({connectionString:url,max:10});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(uid,sql,params=[]){
 const c=await pool.connect();
 try{await c.query('begin');await c.query('set local role authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[uid]);const r=await c.query(sql,params);await c.query('commit');return r.rows[0].r}
 catch(e){await c.query('rollback');throw e}finally{c.release()}
}
async function svc(fn,args=[]){
 const c=await pool.connect();
 try{await c.query('begin');await c.query('set local role service_role');const r=await c.query('SELECT atokore_private.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args);await c.query('commit');return r.rows[0].r}
 catch(e){await c.query('rollback');throw e}finally{c.release()}
}
const push=(uid,ops)=>rpc(uid,'SELECT public.hh_push($1::jsonb) r',[JSON.stringify(ops)]);
async function household(name){
 const A=randomUUID(),B=randomUUID();
 const hh=(await rpc(A,"SELECT public.hh_create($1,'QA-A') r",[name])).household.id;
 const code=(await rpc(A,'SELECT public.hh_invite_create() r')).code;
 await rpc(B,"SELECT public.hh_join($1,'QA-B') r",[code]);
 await pool.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) VALUES($1,'QA safety4') ON CONFLICT DO NOTHING",[hh]);
 return {A,B,hh};
}

async function noticeFence(){
 const {A,B}=await household('QA safety4 notify');
 const assign=async b=>{await push(A,[{op_id:randomUUID(),type:'create',kind:'buy',id:b,qty:1,fields:{name:'合成 '+b,unit:'本'},ts:Date.now()}]);await rpc(A,'SELECT public.hh_buy_assign($1,$2::uuid,0) r',[b,B])};
 await assign('buy_s4_fence_1');
 const [c]=(await svc('notify_claim_v51',[50,120])).filter(x=>x.recipient===B);
 assert.equal((await svc('notify_authorize_v51',[c.id,c.token])).ok,true);
 // The sender's ONE transaction: fence (locks B's membership), "provider call" (900 ms), outcome, commit.
 const sender=await pool.connect();
 await sender.query('begin');await sender.query('set local role service_role');
 const f=(await sender.query('SELECT atokore_private.notify_fence_v51($1,$2) r',[c.id,c.token])).rows[0].r;
 assert.equal(f.ok,true);
 const order=[];
 const leaving=rpc(B,'SELECT public.hh_leave() r').then(()=>order.push('left'));
 await delay(900);order.push('provider accepted');
 await sender.query('SELECT atokore_private.notify_complete_v51($1,$2,$3)',[c.id,c.token,'sent']);
 await sender.query('commit');sender.release();order.push('committed');
 await leaving;
 assert.deepEqual(order,['provider accepted','committed','left'],'the leave waited for the accepted notice');
 // A leave committed BEFORE the fence: the fence answers left (the provider would not be called).
 const {A:A2,B:B2}=await household('QA safety4 notify 2');
 await push(A2,[{op_id:randomUUID(),type:'create',kind:'buy',id:'buy_s4_fence_2',qty:1,fields:{name:'合成',unit:'本'},ts:Date.now()}]);
 await rpc(A2,'SELECT public.hh_buy_assign($1,$2::uuid,0) r',['buy_s4_fence_2',B2]);
 const [d]=(await svc('notify_claim_v51',[50,120])).filter(x=>x.recipient===B2);
 assert.equal((await svc('notify_authorize_v51',[d.id,d.token])).ok,true);
 await rpc(B2,'SELECT public.hh_leave() r');
 assert.deepEqual(await svc('notify_fence_v51',[d.id,d.token]),{ok:false,why:'dropped'});
 console.log('PASS C: a leave waits for a notice being accepted; a leave before the fence stops the call');
}

async function deleteFence(){
 const {A,hh}=await household('QA safety4 photo');
 const file=randomUUID(),p=hh+'/qa_s4_item_1/'+file+'.jpg';
 await push(A,[{op_id:randomUUID(),type:'create',kind:'item',id:'qa_s4_item_1',qty:1,fields:{name:'合成',unit:'個'},ts:Date.now()}]);
 await pool.query("INSERT INTO storage.objects(bucket_id,name,created_at) VALUES('atokore-private-photos-v2',$1,now()-interval '2 days')",[p]);
 const gen=(await pool.query('SELECT atokore_private.photo_object_gen_v51($1,$2) g',['atokore-private-photos-v2',p])).rows[0].g;
 assert.equal(await svc('photo_orphan_object_ok_v51',[p,gen]),true);                  // decided and fenced
 await assert.rejects(pool.query("INSERT INTO atokore_private.photo_ledger_v50(file_id,household_id,record_id,actor,operation_id,expected_seq,state,expires_at) VALUES($1,$2,'qa_s4_item_1',$3,gen_random_uuid(),1,'uploading',now()+interval '5 minutes')",[file,hh,A]),/photo_path_being_deleted/);
 await assert.rejects(pool.query("BEGIN; SET LOCAL session_replication_role = origin; UPDATE atokore_private.records SET fields=fields||jsonb_build_object('photoPath','"+p+"'::text) WHERE household_id='"+hh+"' AND id='qa_s4_item_1'; COMMIT;"),/photo_path_being_deleted/);
 await pool.query('ROLLBACK').catch(()=>{});
 // The outcome confirmed: the fence ends, the key can be used again.
 await pool.query("DELETE FROM storage.objects WHERE bucket_id='atokore-private-photos-v2' AND name=$1",[p]);
 assert.equal(await svc('photo_delete_resolved_v51',['atokore-private-photos-v2',p,'deleted']),'deleted');
 await pool.query("INSERT INTO atokore_private.photo_ledger_v50(file_id,household_id,record_id,actor,operation_id,expected_seq,state,expires_at) VALUES($1,$2,'qa_s4_item_1',$3,gen_random_uuid(),1,'uploading',now()+interval '5 minutes')",[file,hh,A]);
 console.log('PASS A: while a delete is pending, no connection can reserve or reference that key; after the outcome it can');
}

async function undoEstimate(){
 const {A,hh}=await household('QA safety4 undo');
 const item='item-s4-'+randomUUID().slice(0,8),buy='buy-s4-'+randomUUID().slice(0,8);
 await push(A,[{op_id:randomUUID(),type:'create',kind:'item',id:item,qty:1,fields:{name:'合成 おむつ',unit:'袋'},ts:Date.now()},{op_id:randomUUID(),type:'create',kind:'buy',id:buy,qty:1,fields:{name:'合成 おむつ',unit:'袋'},ts:Date.now()}]);
 const t=await rpc(A,'SELECT public.hh_clock_ticket_v51() r');
 const op=randomUUID();
 await push(A,[{op_id:op,type:'complete_buy',buy,item,delta:1,ts:Date.now(),ck:t.ticket,est:[{field:'tps4a',k:'k-s4'}]},
   {op_id:randomUUID(),type:'set',kind:'item',id:item,field:'tps4a',value:{v:1,k:'k-s4',q:1}}]);
 const r=await Promise.allSettled([rpc(A,'SELECT public.hh_undo_purchases($1::jsonb) r',[JSON.stringify([op])]),rpc(A,'SELECT public.hh_undo_purchases_v51($1::jsonb) r',[JSON.stringify([op])])]);
 const undone=r.filter(x=>x.status==='fulfilled').map(x=>x.value.undone).sort();
 assert.deepEqual(undone,[0,1],'undone exactly once');
 const rec=(await pool.query('SELECT qty::int q,fields FROM atokore_private.records WHERE household_id=$1 AND id=$2',[hh,item])).rows[0];
 assert.equal(rec.q,1);assert.equal(rec.fields.tps4a,undefined,'estimate removed with the undo');
 await push(A,[{op_id:randomUUID(),type:'set',kind:'item',id:item,field:'tps4a',value:{v:1,k:'k-s4',q:1}}]);   // a stale tab
 assert.equal((await pool.query('SELECT fields FROM atokore_private.records WHERE household_id=$1 AND id=$2',[hh,item])).rows[0].fields.tps4a,undefined,'not brought back');
 console.log('PASS E: concurrent undo through both RPCs undoes once and removes the estimate entry in the same transaction; a stale write cannot bring it back');
}

(async()=>{await noticeFence();await deleteFence();await undoEstimate()})().then(()=>pool.end(),e=>{console.error(e);pool.end();process.exit(1)});
