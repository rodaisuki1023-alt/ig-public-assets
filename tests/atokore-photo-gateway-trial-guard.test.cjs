const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createDb,call}=require('./household/pg.cjs');
const guard=import('../supabase/functions/_shared/photo-gateway-trial-guard.mjs');
const A='00000000-0000-4000-8000-000000000001';
const B='00000000-0000-4000-8000-000000000002';
const C='00000000-0000-4000-8000-000000000003';
const SA='00000000-0000-4000-9000-000000000001';
const SB='00000000-0000-4000-9000-000000000002';
const SC='00000000-0000-4000-9000-000000000003';
const email=r=>'atokore-qa-'+r+'-f8a63d1e92@example.invalid';
const user=(id,r)=>({id,email:email(r),email_confirmed_at:'2026-11-24T00:00:00Z',is_anonymous:false});
test('trial guard: disabled without explicit enable and three distinct valid server-approved IDs',async()=>{
 const {trialConfig}=await guard;
 for(const raw of [null,'',A,A+','+B,A+','+A+','+C,A+','+B+','+C+',extra','invalid,'+B+','+C])assert.equal(trialConfig('true',raw),null);
 assert.equal(trialConfig('false',[A,B,C].join(',')),null);
 assert.deepEqual(trialConfig('true',[A,B,C].join(',')),{a:A,b:B,c:C});
});
test('trial guard: verified JWT subject/session and confirmed account must match approved cohort',async()=>{
 const {trialConfig,approvedTrialUser}=await guard;
 const cfg=trialConfig('true',[A,B,C].join(','));
 const u=user(A,'a'),claims={sub:A,session_id:SA};
 assert.equal(approvedTrialUser(cfg,u,claims).role,'a');
 for(const v of [{...u,email:'real@example.invalid'},{...u,id:B},{...u,is_anonymous:true},{...u,email_confirmed_at:null}])assert.equal(approvedTrialUser(cfg,v,claims),null);
 for(const v of [{sub:B,session_id:SA},{sub:A},{sub:A,session_id:'bad'},{sub:A,session_id:SA+'\n'}])assert.equal(approvedTrialUser(cfg,u,v),null);
});
test('trial guard: only fixed object and item, rejects real paths, suffixes and malformed UUID',async()=>{
 const {approvedTrialRequest,QA_RECORD,QA_FILE}=await guard;
 const p=A+'/'+QA_RECORD+'/'+QA_FILE+'.jpg';
 assert.equal(approvedTrialRequest({operation:'read',path:p}),true);
 assert.equal(approvedTrialRequest({operation:'write',householdId:A,recordId:QA_RECORD}),true);
 for(const v of [null,{operation:'read',path:p+'\n'},{operation:'read',path:p+'?x=1'},{operation:'read',path:p.replace(QA_RECORD,'real-item')},{operation:'read',path:p.replace(QA_FILE,B)},{operation:'write',householdId:A+'\n',recordId:QA_RECORD},{operation:'write',householdId:A,recordId:'real-item'}])assert.equal(approvedTrialRequest(v),false);
});
test('isolated PostgreSQL: session revocation, expiry, wrong identity, exact cohort and immutable write target',async()=>{
 const {QA_RECORD,QA_FILE}=await guard;
 const db=await createDb();
 try{
  await db.exec("CREATE TABLE auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); CREATE TABLE auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);");
  for(const [id,r,session] of [[A,'a',SA],[B,'b',SB],[C,'c',SC]]){
   await db.query("INSERT INTO auth.users VALUES($1,$2,now())",[id,email(r)]);
   await db.query("INSERT INTO auth.sessions VALUES($1,$2,NULL)",[session,id]);
  }
  const file=path.join(__dirname,'../supabase/proposals/atokore-photo-gateway-trial-session-v50.sql');
  await db.exec(fs.readFileSync(file,'utf8'));
  const h=(await call(db,A,'hh_create',{p_name:'ATK-QA-f8a63d1e92-A',p_display_name:'A'})).household.id;
  const {code}=await call(db,A,'hh_invite_create');
  await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
  await call(db,C,'hh_create',{p_name:'ATK-QA-f8a63d1e92-C',p_display_name:'C'});
  const p=h+'/'+QA_RECORD+'/'+QA_FILE+'.jpg';
  let n=0;const opid=()=>('00000000-0000-4000-8000-'+String(++n).padStart(12,'0'));
  const push=op=>call(db,A,'hh_push',{p_ops:[{op_id:opid(),kind:'item',id:QA_RECORD,ts:Date.now()+n*100,...op}]});
  assert.equal((await push({type:'create',qty:1,fields:{name:'合成商品',unit:'袋'}})).results[0].status,'applied');
  const access=(uid,sid,operation,photo=p)=>db.transaction(async tx=>{
   await tx.exec('SET LOCAL ROLE authenticated');
   await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);
   await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,session_id:sid})]);
   return (await tx.query('SELECT public.hh_photo_access($1,$2) AS ok',[photo,operation])).rows[0].ok;
  });
  assert.equal(await access(A,SA,'write'),true);
  assert.equal(await access(B,SB,'write'),false);
  assert.equal(await access(A,SB,'write'),false);
  assert.equal(await access(A,undefined,'write'),false);
  assert.equal(await access(A,SA,'write',p.replace(QA_FILE,B)),false);
  assert.equal(await access(A,SA,'read'),false);
  assert.equal((await push({type:'set',field:'photoPath',value:p})).results[0].status,'applied');
  assert.equal(await access(A,SA,'write'),false);
  assert.equal(await access(A,SA,'read'),true);
  assert.equal(await access(B,SB,'read'),true);
  assert.equal(await access(C,SC,'read'),false);
  assert.equal(await access(B,SB,'delete'),false);
  await db.query("UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=$1",[SB]);
  assert.equal(await access(B,SB,'read'),false);
  await db.query("UPDATE auth.sessions SET not_after=NULL WHERE id=$1",[SB]);
  assert.equal(await access(B,SB,'read'),true);
  await db.query("DELETE FROM auth.sessions WHERE id=$1",[SB]);
  assert.equal(await access(B,SB,'read'),false);
  await db.query("INSERT INTO auth.sessions VALUES($1,$2,NULL)",[SB,B]);
  assert.equal(await access(B,SB,'read'),true);
  await call(db,A,'hh_remove_member',{p_user:B});
  assert.equal(await access(B,SB,'read'),false);
  assert.equal(await access(A,SA,'read'),true);
  assert.equal(await access(A,SA,'delete'),true);
 } finally {await db.close();}
});
