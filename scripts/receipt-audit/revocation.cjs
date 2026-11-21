// Only a disposable localhost PostgreSQL database. No Supabase connection or real household.
const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const url = process.env.ATOKORE_SQL_TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/atokore_ci' || !['localhost','127.0.0.1'].includes(new URL(url).hostname)) throw Error('Isolated localhost atokore_ci required');
const pool = new Pool({ connectionString: url, max: 8 });
const A = randomUUID(), B = randomUUID();
const delay = ms => new Promise(r => setTimeout(r, ms));
async function begin(uid) {
  const c = await pool.connect();
  await c.query('begin'); await c.query("set local statement_timeout='10s'");
  await c.query('set local role authenticated');
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
  return c;
}
async function call(uid, sql, params = []) {
  const c = await begin(uid);
  try { const r = await c.query(sql, params); await c.query('commit'); return r.rows[0]?.r; }
  catch(e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
function run(c, sql, params) {
  return c.query(sql, params).then(async r => { await c.query('commit'); return { value: r.rows[0]?.r }; }, async error => { await c.query('rollback'); return { error }; });
}
async function blocked(pid) { return (await pool.query('select cardinality(pg_blocking_pids($1))>0 as b',[pid])).rows[0].b; }
async function waitForBlock(pid) {
  for(let i=0;i<150;i++) { if(await blocked(pid)) return; await delay(20); }
  throw Error('No actual row-lock wait observed');
}
async function scenario(hh, label, fixed) {
  // Reset only our synthetic fixture in this disposable database.
  await pool.query('update atokore_private.members set left_at=null where household_id=$1 and user_id=$2',[hh,B]);
  const fp = createHash('sha256').update(label).digest('hex');
  assert((await call(B,'select public.hh_receipt_claim($1,false) r',[fp])).claimed);
  const hold = await pool.connect(), member = await begin(B), owner = await begin(A);
  try {
    await hold.query('begin');
    await hold.query('select fingerprint from atokore_private.receipt_imports where household_id=$1 and fingerprint=$2 for update',[hh,fp]);
    const finishing = run(member,'select public.hh_receipt_finish($1,true) r',[fp]);
    await waitForBlock(member.processID); // Membership check completed; finish is waiting on the receipt.
    let ownerDone = false;
    const removing = run(owner,'select public.hh_remove_member($1) r',[B]).then(r => { ownerDone=true; return r; });
    let ownerBlocked = false;
    for(let i=0;i<150;i++) { if(await blocked(owner.processID)) {ownerBlocked=true;break;} if(ownerDone)break; await delay(20); }
    if(fixed) assert(ownerBlocked,'removal must serialize behind an already-authorized finish');
    else { const removed=await removing; assert(!removed.error); assert(ownerDone); }
    const removedBeforeFinish = (await pool.query('select left_at is not null as removed from atokore_private.members where household_id=$1 and user_id=$2',[hh,B])).rows[0].removed;
    assert.equal(removedBeforeFinish,!fixed);
    await hold.query('commit');
    const [finished,removed] = await Promise.all([finishing,removing]);
    if(finished.error)throw finished.error; if(removed.error)throw removed.error;
    assert.equal(finished.value.ok,true);
    for(const sql of ['select public.hh_receipt_claim($1,false) r','select public.hh_receipt_finish($1,true) r']) {
      await assert.rejects(call(B,sql,[fp]),e=>e.code==='42501');
    }
    console.log(JSON.stringify({label,actualReceiptLockWait:true,removalWaited:ownerBlocked,finishSucceededAfterCommittedRemoval:removedBeforeFinish,laterCallsDenied:true}));
  } finally {
    await hold.query('rollback'); await member.query('rollback'); await owner.query('rollback');
    hold.release(); member.release(); owner.release();
  }
}
async function main() {
  await pool.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  const dir=path.resolve(__dirname,'../../supabase/migrations');
  // Historical negative control: load the original migrations, explicitly excluding
  // the new production fix. Otherwise the "vulnerable baseline" becomes fixed
  // before the test starts and the intentionally blocked receipt waits forever.
  const appliedFixFile='20261118135221_atokore_receipt_member_lock_v50.sql';
  for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&!f.includes('storage')&&f!==appliedFixFile).sort())
    await pool.query(fs.readFileSync(path.join(dir,f),'utf8'));
  const household=await call(A,"select public.hh_create('Synthetic receipt audit','QA owner') r");
  const hh=household.household.id;
  const invite=await call(A,'select public.hh_invite_create() r');
  await call(B,'select public.hh_join($1,$2) r',[invite.code,'QA member']);
  await scenario(hh,'current-published-sql',false);
  const sql=fs.readFileSync(path.join(dir,'20261101120000_atokore_receipt_imports.sql'),'utf8');
  const old='v_hh uuid := atokore_private.my_household(v_user);';
  assert.equal(sql.split(old).length-1,2);
  const expected=sql.replaceAll(old,'v_hh uuid := atokore_private.lock_member(v_user);');
  const expectedDefinitions=expected.match(/create or replace function public\.hh_receipt_[\s\S]*?end \$\$;/g);
  // The exact SQL proposed for later review is the SQL tested here, not an in-memory-only sketch.
  // No live Supabase connection: this program requires localhost/atokore_ci at startup.
  const reviewSql=fs.readFileSync(path.join(__dirname,'candidate-member-lock.sql'),'utf8');
  const definitions=reviewSql.match(/create or replace function public\.hh_receipt_[\s\S]*?end \$\$;/g);
  assert.equal(definitions?.length,2);
  assert.deepEqual(definitions,expectedDefinitions,'review SQL must only change two membership lookups');
  // Also verify the exact checked-in migration that was applied to trial Supabase.
  const deployedSql=fs.readFileSync(path.join(dir,appliedFixFile),'utf8');
  const deployedDefinitions=deployedSql.match(/create or replace function public\.hh_receipt_[\s\S]*?end \$\$;/g);
  assert.equal(deployedDefinitions?.length,2);
  assert.deepEqual(deployedDefinitions,definitions,'applied migration must match isolated race-tested candidate exactly');
  await pool.query(deployedDefinitions.join('\n'));
  await scenario(hh,'candidate-household-lock',true);

  // Additional conservative authorization ordering verification for READ RPCs.
  // Only synthetic records in the disposable localhost database are used.
  const createOp={op_id:randomUUID(),type:'create',kind:'item',id:'synthetic_read_item_1',
    fields:{name:'Synthetic audit diapers'},qty:2,ts:Date.now()};
  const result=await call(A,"select public.hh_push($1::jsonb,'isolated-audit') r",[JSON.stringify([createOp])]);
  assert.equal(result.results?.[0]?.status,'applied','synthetic seed push must succeed');
  await readScenario(hh,'hh_pull',false);
  await readScenario(hh,'hh_changes',false);

  const householdFile=fs.readFileSync(path.join(dir,'20261022000000_atokore_household.sql'),'utf8');
  const historyFile=fs.readFileSync(path.join(dir,'20261025090000_atokore_history_w2.sql'),'utf8');
  const baselinePull=(householdFile.match(/create or replace function public\.hh_pull\([\s\S]*?end \$\$;/g)||[])[0];
  const baselineChanges=(historyFile.match(/create or replace function public\.hh_changes\([\s\S]*?end \$\$;/g)||[])[0];
  assert(baselinePull&&baselineChanges);
  const hardenRead=s=>s.replace('language plpgsql stable security definer','language plpgsql volatile security definer')
    .replace('atokore_private.my_household(v_user)','atokore_private.read_member(v_user)');
  const expectedRead=[hardenRead(baselinePull),hardenRead(baselineChanges)];
  const candidate=fs.readFileSync(path.join(__dirname,'candidate-read-member-lock.sql'),'utf8');
  const readDefinitions=candidate.match(/create or replace function public\.hh_(?:pull|changes)\([\s\S]*?end \$\$;/g);
  assert.deepEqual(readDefinitions,expectedRead,'review SQL must change one membership lookup and volatility per RPC');
  const sharedHelper=candidate.match(/create or replace function atokore_private\.read_member\([\s\S]*?end \$\$;/g);
  assert.equal(sharedHelper?.length,1,'one internal read_member helper');
  assert.match(sharedHelper[0],/for share\s*;/i,'readers must not take exclusive household row locks');
  assert.match(candidate,/revoke all on function atokore_private\.read_member\(uuid\) from public, anon, authenticated/i);

  // Negative control: the earlier FOR UPDATE candidate serialized unrelated readers.
  const exclusiveRead=s=>s.replace('language plpgsql stable security definer','language plpgsql volatile security definer')
    .replace('atokore_private.my_household(v_user)','atokore_private.lock_member(v_user)');
  await pool.query([exclusiveRead(baselinePull),exclusiveRead(baselineChanges)].join('\n'));
  await twoReaderScenario(hh,true);

  // The actual proposed SQL is used for the acceptance test, not just an in-memory sketch.
  await pool.query(candidate);
  await twoReaderScenario(hh,false);
  await readScenario(hh,'hh_pull',true);
  await readScenario(hh,'hh_changes',true);

  // A second independent household must never see A's synthetic stock or history.
  // The SAME receipt fingerprint is valid independently in each household.
  const outsider=randomUUID();
  const outsideHousehold=await call(outsider,"select public.hh_create('Isolated unrelated household','Other test owner') r");
  assert.notEqual(outsideHousehold.household.id,hh,'two distinct synthetic households required');
  const outsiderId='isolated_other_item_9';
  const otherOp={op_id:randomUUID(),type:'create',kind:'item',id:outsiderId,
    fields:{name:'Synthetic other household only'},qty:7,ts:Date.now()};
  const otherPush=await call(outsider,"select public.hh_push($1::jsonb,'isolated-audit') r",[JSON.stringify([otherOp])]);
  assert.equal(otherPush.results?.[0]?.status,'applied');
  const firstRows=(await call(A,'select public.hh_pull(0,20) r')).records;
  const otherRows=(await call(outsider,'select public.hh_pull(0,20) r')).records;
  assert(firstRows.some(x=>x.id==='synthetic_read_item_1'));
  assert(otherRows.some(x=>x.id===outsiderId));
  assert(!firstRows.some(x=>x.id===outsiderId),'first household cannot read other records');
  assert(!otherRows.some(x=>x.id==='synthetic_read_item_1'),'unrelated household cannot read first records');
  const firstChanges=await call(A,'select public.hh_changes(20) r');
  const otherChanges=await call(outsider,'select public.hh_changes(20) r');
  assert(firstChanges.some(x=>x.record_id==='synthetic_read_item_1'));
  assert(otherChanges.some(x=>x.record_id===outsiderId));
  assert(!firstChanges.some(x=>x.record_id===outsiderId),'first household cannot read other change history');
  assert(!otherChanges.some(x=>x.record_id==='synthetic_read_item_1'),'other household cannot read first change history');
  const sameFingerprint=createHash('sha256').update('same barcode for independent synthetic households').digest('hex');
  assert.equal((await call(A,'select public.hh_receipt_claim($1,false) r',[sameFingerprint])).claimed,true);
  assert.equal((await call(outsider,'select public.hh_receipt_claim($1,false) r',[sameFingerprint])).claimed,true,
    'receipt duplicate claims must be scoped to the current household');
  const otherMemberDenied=await call(outsider,'select public.hh_remove_member($1) r',[B]);
  assert.equal(otherMemberDenied.removed,0,'owner of household 2 cannot remove household 1 member');
  console.log(JSON.stringify({test:'cross-household isolated authorization',households:2,
    stockSeparated:true,historySeparated:true,sameReceiptFingerprintScoped:true,foreignRemovalDenied:true}));
  await photoPolicyScenario({hh,outsider,otherHousehold:outsideHousehold.household.id,outsiderId});


}

/** Serialize a read against owner removal in disposable localhost atokore_ci. */
async function readScenario(hh, name, fixed) {
  await pool.query('update atokore_private.members set left_at=null where household_id=$1 and user_id=$2',[hh,B]);
  const owner=await begin(A), member=await begin(B);
  const sql=name==='hh_pull' ? 'select public.hh_pull(0,20) r' : 'select public.hh_changes(20) r';
  try {
    const removed=await owner.query('select public.hh_remove_member($1) r',[B]);
    assert.equal(removed.rows[0]?.r?.removed,1);
    // Owner has updated membership but holds the transaction and its row lock open.
    const reading=run(member,sql);
    if(fixed) {
      await waitForBlock(member.processID);
      await owner.query('commit');
      const result=await reading;
      assert.equal(result.error?.code,'42501',name+' read must reject after removal commit');
    } else {
      const result=await Promise.race([reading,delay(2000).then(()=>{throw Error(name+' baseline unexpectedly waited')})]);
      if(result.error)throw result.error;
      const entries=name==='hh_pull' ? result.value?.records : result.value;
      assert(Array.isArray(entries)&&entries.length>0,name+' needs nonempty synthetic fixture');
      await owner.query('commit');
    }
    await assert.rejects(call(B,sql),e=>e.code==='42501');
    console.log(JSON.stringify({rpc:name,readWaitedForRemoval:fixed,removedJwtDenied:true}));
  } finally {
    await owner.query('rollback').catch(()=>{});
    await member.query('rollback').catch(()=>{});
    owner.release();member.release();
  }
}


/** Both signed-in household members can read concurrently with FOR SHARE, while
 * owner removal (FOR UPDATE) waits for any reader holding the household row.
 * All clients/transactions/records are disposable synthetic localhost only.
 */
async function twoReaderScenario(hh, exclusive) {
  await pool.query('update atokore_private.members set left_at=null where household_id=$1 and user_id=$2',[hh,B]);
  const first=await begin(A),second=await begin(B);
  try {
    const one=await first.query('select public.hh_pull(0,20) r');
    assert(one.rows[0]?.r?.records?.length>0,'first read must have synthetic fixtures');
    const secondReading=run(second,'select public.hh_changes(20) r');
    if(exclusive){
      await waitForBlock(second.processID);
      await first.query('commit');
      const finished=await secondReading;
      if(finished.error)throw finished.error;
      assert(Array.isArray(finished.value)&&finished.value.length>0,'second reader results');
    }else{
      // The first authenticated reader deliberately retains its FOR SHARE
      // transaction. An unrelated reader must finish without waiting for it.
      const finished=await Promise.race([secondReading,delay(2500).then(()=>{throw Error('Two simple reads serialized on household lock')})]);
      if(finished.error)throw finished.error;
      assert(Array.isArray(finished.value)&&finished.value.length>0,'second reader results');
      assert.equal(await blocked(second.processID),false,'second reader must not be blocked');
      const owner=await begin(A);
      try{
        const removal=run(owner,'select public.hh_remove_member($1) r',[B]);
        await waitForBlock(owner.processID);
        await first.query('commit');
        const complete=await removal;
        if(complete.error)throw complete.error;
        assert.equal(complete.value.removed,1);
        await assert.rejects(call(B,'select public.hh_pull(0,20) r'),e=>e.code==='42501');
      }finally{
        await owner.query('rollback').catch(()=>{});
        owner.release();
      }
    }
    console.log(JSON.stringify({test:'two household readers',exclusive,secondReaderWaited:exclusive,removalBlockedBehindReader:!exclusive}));
  }finally{
    await first.query('rollback').catch(()=>{});
    await second.query('rollback').catch(()=>{});
    first.release();second.release();
  }
}


/** Check the checked-in Supabase photo policy with real PostgreSQL RLS and
 * synthetic role sessions in an isolated localhost DB. The small storage table
 * stubs verify policy semantics only, not Storage HTTP, signed links or Auth.
 */
async function photoPolicyScenario({hh,outsider,otherHousehold,outsiderId}) {
  await pool.query([
    'create schema storage;',
    'create table storage.buckets (id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);',
    'create table storage.objects (id uuid primary key,bucket_id text not null,name text not null);',
    'alter table storage.objects enable row level security;',
    'grant usage on schema storage to authenticated;',
    'grant select,insert,delete on storage.objects to authenticated;'
  ].join('\n'));
  const migration=fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261024111742_atokore_photo_storage_v44.sql'),'utf8');
  for (const policy of ['atokore_photo_read','atokore_photo_insert','atokore_photo_delete']) {
    assert(migration.includes('create policy '+policy),'missing real Storage policy '+policy);
  }
  await pool.query(migration);

  const bucket='atokore-product-photos';
  const idA='synthetic_read_item_1';
  const pathA=hh+'/'+idA+'/'+randomUUID()+'.jpg';
  const pathB=otherHousehold+'/'+outsiderId+'/'+randomUUID()+'.jpg';
  const count=async (uid,name)=>Number(await call(uid,
    'select count(*)::integer r from storage.objects where bucket_id=$1 and name=$2',[bucket,name]));
  await pool.query('update atokore_private.members set left_at=null where household_id=$1 and user_id=$2',[hh,B]);

  const inserted=await call(A,'insert into storage.objects(id,bucket_id,name) values($1,$2,$3) returning name r',[randomUUID(),bucket,pathA]);
  assert.equal(inserted,pathA);
  assert.equal(await count(A,pathA),1);
  assert.equal(await count(B,pathA),1);
  assert.equal(await count(outsider,pathA),0,'other household cannot fetch private photo');
  await call(outsider,'insert into storage.objects(id,bucket_id,name) values($1,$2,$3) returning name r',[randomUUID(),bucket,pathB]);
  assert.equal(await count(outsider,pathB),1);
  assert.equal(await count(A,pathB),0,'household A cannot fetch photo B');

  for(const [b,name] of [
    [bucket,hh+'/not_a_registered_product/'+randomUUID()+'.jpg'],
    [bucket,hh+'/'+idA+'/'+randomUUID()+'.png'],
    ['unrelated-bucket',hh+'/'+idA+'/'+randomUUID()+'.jpg'],
    [bucket,pathB],
  ])await assert.rejects(
    call(A,'insert into storage.objects(id,bucket_id,name) values($1,$2,$3) returning name r',[randomUUID(),b,name]),
    e=>e.code==='42501','invalid photo upload must fail with RLS');

  // B remains authenticated with their original token, but is no longer a member.
  await call(A,'select public.hh_remove_member($1) r',[B]);
  assert.equal(await count(B,pathA),0,'removed member cannot read photo');
  assert.equal(await count(A,pathA),1,'current owner retains photo access');
  const removeByB=await call(B,'delete from storage.objects where bucket_id=$1 and name=$2 returning name r',[bucket,pathA]);
  assert.equal(removeByB,undefined,'removed member cannot delete photo');
  await assert.rejects(
    call(B,'insert into storage.objects(id,bucket_id,name) values($1,$2,$3) returning name r',[randomUUID(),bucket,hh+'/'+idA+'/'+randomUUID()+'.jpg']),
    e=>e.code==='42501','removed member cannot upload photo');

  await pool.query("update atokore_private.records set deleted=true where household_id=$1 and kind='item' and id=$2",[hh,idA]);
  assert.equal(await count(A,pathA),0,'deleted product photos cannot be read');
  assert.equal(await count(outsider,pathB),1,'independent household remains available');
  const names=(await pool.query("select policyname from pg_catalog.pg_policies where schemaname='storage' and tablename='objects' and policyname like 'atokore_photo_%' order by policyname")).rows.map(x=>x.policyname);
  assert.deepEqual(names,['atokore_photo_delete','atokore_photo_insert','atokore_photo_read']);
  const b=(await pool.query('select public,file_size_limit,allowed_mime_types from storage.buckets where id=$1',[bucket])).rows[0];
  assert.equal(b.public,false);
  assert.equal(Number(b.file_size_limit),81920);
  assert.deepEqual(b.allowed_mime_types,['image/jpeg']);
  console.log(JSON.stringify({test:'isolated-photo-rls',source:'checked-in migration',
    twoHouseholds:true,privateBucket:true,mimeJpegOnly:true,limitBytes:81920,
    familyReadBeforeRemoval:true,foreignReadDenied:true,removedMemberReadDenied:true,
    removedMemberWriteDenied:true,deletedItemPhotoReadDenied:true,liveSupabaseChanged:false}));
}

main().then(()=>pool.end(),async e=>{console.error(e.stack);await pool.end();process.exitCode=1;});
