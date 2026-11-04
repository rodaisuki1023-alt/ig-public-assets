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
  for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&!f.includes('storage')).sort())await pool.query(fs.readFileSync(path.join(dir,f),'utf8'));
  const household=await call(A,"select public.hh_create('Synthetic receipt audit','QA owner') r");
  const hh=household.household.id;
  const invite=await call(A,'select public.hh_invite_create() r');
  await call(B,'select public.hh_join($1,$2) r',[invite.code,'QA member']);
  await scenario(hh,'current-published-sql',false);
  const sql=fs.readFileSync(path.join(dir,'20261101120000_atokore_receipt_imports.sql'),'utf8');
  const old='v_hh uuid := atokore_private.my_household(v_user);';
  assert.equal(sql.split(old).length-1,2);
  const candidate=sql.replaceAll(old,'v_hh uuid := atokore_private.lock_member(v_user);');
  // Candidate is applied ONLY to this disposable database, never to the real migration file.
  const definitions=candidate.match(/create or replace function public\.hh_receipt_[\s\S]*?end \$\$;/g);
  assert.equal(definitions.length,2);
  await pool.query(definitions.join('\n'));
  await scenario(hh,'candidate-household-lock',true);
}
main().then(()=>pool.end(),async e=>{console.error(e.stack);await pool.end();process.exitCode=1;});
