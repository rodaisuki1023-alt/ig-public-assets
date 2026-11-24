// Local isolated fixture: real proposal SQL, mock Auth table and sessions.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{createDb,call}=require('./household/pg.cjs');
test('scoped general trial defaults closed, leaves existing records untouched, and denies outsiders',async()=>{
 const db=await createDb(),A=randomUUID(),B=randomUUID(),C=randomUUID(),D=randomUUID(),SA=randomUUID(),SB=randomUUID(),SC=randomUUID(),SD=randomUUID();
 try{
  await db.exec('CREATE TABLE auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);CREATE TABLE auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz)');
  for(const [uid,sid,email] of [[A,SA,'atokore-gqa-a-20261124@example.invalid'],[B,SB,'atokore-gqa-b-20261124@example.invalid'],[C,SC,'atokore-gqa-c-20261124@example.invalid'],[D,SD,'existing@example.invalid']]){
   await db.query('INSERT INTO auth.users VALUES($1,$2,now())',[uid,email]);
   await db.query('INSERT INTO auth.sessions VALUES($1,$2,NULL)',[sid,uid]);
  }
  const H=(await call(db,A,'hh_create',{p_name:'ATK-GQA-20261124-A',p_display_name:'A'})).household.id;
  const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
  const HC=(await call(db,C,'hh_create',{p_name:'ATK-GQA-20261124-C',p_display_name:'C'})).household.id;
  const HD=(await call(db,D,'hh_create',{p_name:'existing',p_display_name:'D'})).household.id;
  const R='qa_general_20261124_item',R2='existing_stock';
  const push=(uid,id,fields)=>call(db,uid,'hh_push',{p_ops:[{op_id:randomUUID(),kind:'item',id,ts:Date.now(),...fields}]});
  for(const [u,r] of [[A,R],[C,R],[D,R2]])assert.equal((await push(u,r,{type:'create',qty:1,fields:{name:'QA',unit:'個'}})).results[0].status,'applied');
  const legacy=HD+'/'+R2+'/'+randomUUID()+'.jpg';
  assert.equal((await push(D,R2,{type:'set',field:'photoPath',value:legacy})).results[0].status,'applied');
  const names=['atokore-photo-reservation-v50.sql','atokore-photo-lifecycle-v50.sql','atokore-photo-service-v50.sql','atokore-photo-budget-v50.sql','atokore-photo-general-trial-scope-v50.sql'];
  const sources=names.map(n=>fs.readFileSync(path.join(__dirname,'../supabase/proposals',n),'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
  await db.exec('BEGIN;\n'+sources.join('\n')+'\nCOMMIT;');
  const svc=async(uid,sid,action,h,r,extra={})=>db.transaction(async tx=>{
   await tx.exec('SET LOCAL ROLE service_role');
   const args={p_uid:uid,p_session:sid,p_action:action,p_h:h,p_r:r,...extra};
   return (await tx.query('SELECT public.hh_photo_service_v50('+Object.keys(args).map((k,i)=>k+'=>$'+(i+1)).join(',')+') r',Object.values(args))).rows[0].r;
  });
  const budget=(u,s,h)=>db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE service_role');return (await tx.query("SELECT public.hh_photo_budget_service_v50($1,$2,$3,'read') r",[u,s,h])).rows[0].r});
  const rev=Number((await db.query("SELECT seq FROM atokore_private.records WHERE household_id=$1 AND id=$2",[H,R])).rows[0].seq);
  const args={p_operation:randomUUID(),p_expected:null,p_seq:rev,p_sha:'a'.repeat(64)};
  await assert.rejects(svc(A,SA,'reserve',H,R,args),/photo_trial_denied/);
  assert.equal(await budget(A,SA,H),false);
  await db.query('UPDATE atokore_private.photo_general_trial_scope_v50 SET a=$1,b=$2,c=$3,enabled=true',[A,B,C]);
  assert.equal(await budget(A,SA,H),true);
  assert.equal(await budget(D,SD,HD),false);
  assert.equal(await budget(C,SC,H),false); // base membership check
  await assert.rejects(svc(D,SD,'reserve',HD,R2,args),/photo_trial_denied/);
  await assert.rejects(svc(A,SA,'reserve',H,R2,args),/photo_trial_denied/);
  await assert.rejects(svc(C,SC,'reserve',H,R,args),/photo_denied/);
  assert.equal((await svc(A,SA,'reserve',H,R,args)).state,'reserved');
  // Existing unrelated product keeps its original legacy behavior and data.
  assert.equal((await push(D,R2,{type:'add',delta:1})).results[0].status,'applied');
  assert.equal((await db.query("SELECT fields->>'photoPath' p FROM atokore_private.records WHERE household_id=$1 AND id=$2",[HD,R2])).rows[0].p,legacy);
  await assert.rejects(push(A,R,{type:'set',field:'photoPath',value:H+'/'+R+'/'+randomUUID()+'.jpg'}),/photo_reference_requires_gateway/);
  const acl=(await db.query("SELECT has_function_privilege('service_role','atokore_private.hh_photo_service_v50(uuid,uuid,text,uuid,text,uuid,uuid,text,bigint,text,integer)','EXECUTE') inner,has_function_privilege('authenticated','public.hh_photo_service_v50(uuid,uuid,text,uuid,text,uuid,uuid,text,bigint,text,integer)','EXECUTE') outer")).rows[0];
  assert.deepEqual(acl,{inner:false,outer:false});
  await db.query('UPDATE atokore_private.photo_general_trial_scope_v50 SET enabled=false');
  await assert.rejects(svc(A,SA,'reserve',H,R,args),/photo_trial_denied/);
  assert.equal(await budget(A,SA,H),false);
 }finally{await db.close()}
});
