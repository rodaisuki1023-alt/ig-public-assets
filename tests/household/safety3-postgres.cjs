// Real PostgreSQL, separate connections (CI's disposable database only; run after
// photo-legacy-close-postgres.cjs, which leaves the photo drafts applied). Work 6th fixes under real
// concurrency, which PGlite (one connection) cannot show:
//  B) an object rewritten in another connection after its read check: the check no longer counts,
//  C) two senders reserving at the same moment never get the same notice; an expired lease is taken over,
//  E) the OLD undo RPC from two connections at once on an expired trial purchase: both refused, nothing
//     changes; a fresh one is undone exactly once.
const {Pool}=require('pg');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const url=process.env.ATOKORE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/atokore_ci'||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Use an isolated localhost atokore_ci database');
const pool=new Pool({connectionString:url,max:10});
const root=path.resolve(__dirname,'../..');
const P=f=>fs.readFileSync(path.join(root,'supabase/proposals',f),'utf8');
const LEGACY='atokore-product-photos',V2='atokore-private-photos-v2',BACKUP='atokore-photo-backup-v51';
const has=async sql=>(await pool.query(sql)).rows[0].ok;
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
async function household(name){
 const A=randomUUID(),B=randomUUID();
 const hh=(await rpc(A,"SELECT public.hh_create($1,'QA-A') r",[name])).household.id;
 const code=(await rpc(A,'SELECT public.hh_invite_create() r')).code;
 await rpc(B,"SELECT public.hh_join($1,'QA-B') r",[code]);
 await pool.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) VALUES($1,'QA safety3') ON CONFLICT DO NOTHING",[hh]);
 return {A,B,hh};
}
const push=(uid,ops)=>rpc(uid,'SELECT public.hh_push($1::jsonb) r',[JSON.stringify(ops)]);

async function photoGeneration(){
 assert.ok(await has("SELECT to_regprocedure('atokore_private.photo_object_gen_v51(text,text)') IS NOT NULL ok"),'run photo-legacy-close-postgres.cjs first');
 await pool.query("INSERT INTO storage.buckets(id,name,public) VALUES($1,$1,false) ON CONFLICT(id) DO NOTHING",[BACKUP]);
 const {A,hh}=await household('QA safety3 photo');
 const id='qa_s3_item_1';
 await push(A,[{op_id:randomUUID(),type:'create',kind:'item',id,qty:1,fields:{name:'合成 '+id,unit:'個'},ts:Date.now()}]);
 const legacy=hh+'/'+id+'/'+randomUUID()+'.jpg';
 await pool.query("BEGIN; SET LOCAL session_replication_role = replica; UPDATE atokore_private.records SET fields=fields||jsonb_build_object('photoPath','"+legacy+"'::text) WHERE household_id='"+hh+"' AND id='"+id+"'; COMMIT;");
 await pool.query("INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)",[LEGACY,legacy]);
 const m=await svc('photo_legacy_begin_v51',[hh,id]);
 await pool.query("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES($1,$2,'{\"eTag\":\"e1\",\"size\":\"900\"}')",[V2,m.target_path]);
 const SHA='c'.repeat(64);
 assert.equal((await svc('photo_legacy_commit_v51',[m.file_id,900,SHA,SHA])).status,'switched');
 const t=await svc('photo_read_target_v51',[m.file_id]);
 // Another connection rewrites the same path while the read runs (Storage bumps eTag and updated_at).
 const w=await pool.connect();
 await w.query("UPDATE storage.objects SET metadata='{\"eTag\":\"e2\",\"size\":\"900\"}',updated_at=clock_timestamp() WHERE bucket_id=$1 AND name=$2",[V2,m.target_path]);w.release();
 await assert.rejects(svc('photo_read_checked_v51',[m.file_id,SHA,900,t.gen]),/photo_read_mismatch/);
 const t2=await svc('photo_read_target_v51',[m.file_id]);
 assert.notEqual(t2.gen,t.gen);
 assert.equal((await svc('photo_read_checked_v51',[m.file_id,SHA,900,t2.gen])).state??'ok','ok');
 await pool.query("INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)",[BACKUP,m.target_path]);
 await svc('photo_legacy_backup_recorded_v51',[m.file_id,SHA,900]);
 assert.equal((await svc('photo_legacy_delete_ok_v51',[m.file_id])).ok,true);
 // Rewritten again after the read (committed in another connection): the delete is refused.
 await pool.query("UPDATE storage.objects SET metadata='{\"eTag\":\"e3\",\"size\":\"900\"}',updated_at=clock_timestamp() WHERE bucket_id=$1 AND name=$2",[V2,m.target_path]);
 assert.deepEqual(await svc('photo_legacy_delete_ok_v51',[m.file_id]),{ok:false,why:'read_not_fresh'});
 console.log('PASS B: a rewrite in another connection invalidates the read check; the legacy delete is refused');
}

async function notifyClaims(){
 if(!await has("SELECT to_regprocedure('atokore_private.notify_claim_v51(integer,integer)') IS NOT NULL ok"))await pool.query(P('atokore-buy-assignment-v51.sql'));
 const {A,B,hh}=await household('QA safety3 notify');
 const buys=[];
 for(let i=0;i<20;i++){const b='buy_s3_'+String(i).padStart(4,'0');buys.push(b);
  await push(A,[{op_id:randomUUID(),type:'create',kind:'buy',id:b,qty:1,fields:{name:'合成 '+i,unit:'本'},ts:Date.now()}]);
  await rpc(A,'SELECT public.hh_buy_assign($1,$2::uuid,0) r',[b,B]);}
 // Five senders at once, each asking for 8: every notice is handed out once, none twice.
 const got=(await Promise.all([0,1,2,3,4].map(()=>svc('notify_claim_v51',[8,60])))).flat().filter(c=>c.recipient===B);
 const ids=got.map(c=>c.id);
 assert.equal(new Set(ids).size,ids.length,'no notice reserved twice');
 assert.equal(ids.length,20);
 // A lease held by a sender that stopped is taken over; the old holder can no longer send.
 const c=got[0];
 await pool.query("UPDATE atokore_private.notify_outbox SET lease_until=now()-interval '1 second' WHERE id=$1",[c.id]);
 const [x,y]=await Promise.all([svc('notify_claim_v51',[50,60]),svc('notify_claim_v51',[50,60])]);
 const again=[...x,...y].filter(r=>r.id===c.id);
 assert.equal(again.length,1);
 assert.deepEqual(await svc('notify_authorize_v51',[c.id,c.token]),{ok:false,why:'not_owner'});
 // Two senders finishing the same notice at once: marked once.
 assert.equal((await svc('notify_authorize_v51',[again[0].id,again[0].token])).ok,true);
 const done=await Promise.all([svc('notify_complete_v51',[c.id,again[0].token,'sent']),svc('notify_complete_v51',[c.id,again[0].token,'sent'])]);
 assert.deepEqual(done.sort(),['already_sent','marked']);
 assert.ok(hh);
 console.log('PASS C: 5 concurrent senders reserve 20 notices without a duplicate; a lapsed lease moves; completion is exactly once');
}

async function undoGuard(){
 if(!await has("SELECT to_regprocedure('atokore_private.purchase_undo_guard_v51()') IS NOT NULL ok"))await pool.query(P('atokore-purchase-undo-window-v51.sql'));
 const {A,hh}=await household('QA safety3 undo');
 async function bought(ageS){
  const item='item-s3-'+randomUUID().slice(0,8),buy='buy-s3-'+randomUUID().slice(0,8);
  await push(A,[{op_id:randomUUID(),type:'create',kind:'item',id:item,qty:1,fields:{name:'合成 ミルク',unit:'缶'},ts:Date.now()},{op_id:randomUUID(),type:'create',kind:'buy',id:buy,qty:2,fields:{name:'合成 ミルク',unit:'缶'},ts:Date.now()}]);
  const at=Date.now()-ageS*1000,op=randomUUID();
  await push(A,[{op_id:op,type:'complete_buy',buy,item,delta:2,ts:at}]);
  await pool.query("UPDATE atokore_private.ops SET at=to_timestamp($1/1000.0) WHERE op_id=$2",[at,op]);
  return {op,item};
 }
 const qty=async id=>Number((await pool.query('SELECT qty FROM atokore_private.records WHERE household_id=$1 AND id=$2',[hh,id])).rows[0].qty);
 const old=await bought(900);
 const r=await Promise.allSettled([0,1].map(()=>rpc(A,'SELECT public.hh_undo_purchases($1::jsonb) r',[JSON.stringify([old.op])])));
 assert.deepEqual(r.map(x=>x.status),['rejected','rejected']);
 assert.ok(r.every(x=>/purchase_undo_expired/.test(x.reason.message)));
 assert.equal(await qty(old.item),3,'stock stays as bought');
 const fresh=await bought(30);
 const both=await Promise.all([0,1].map(()=>rpc(A,'SELECT public.hh_undo_purchases($1::jsonb) r',[JSON.stringify([fresh.op])])));
 assert.deepEqual(both.map(x=>x.undone).sort(),[0,1],'undone exactly once');
 assert.equal(await qty(fresh.item),1);
 console.log('PASS E: the old RPC from two connections cannot undo an expired trial purchase; a fresh one is undone once');
}

(async()=>{await photoGeneration();await notifyClaims();await undoGuard()})().then(()=>pool.end(),e=>{console.error(e);pool.end();process.exit(1)});
