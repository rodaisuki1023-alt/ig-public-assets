// v51 draft: shopping assignments and replies (isolated PGlite; never a real project).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {createDb,call}=require('./household/pg.cjs');
const policy=require('../atokore-live-v125/family-prep-v51.js');
const SQL=fs.readFileSync(path.join(__dirname,'../supabase/proposals/atokore-buy-assignment-v51.sql'),'utf8');
const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b2',C='00000000-0000-4000-8000-0000000000c3',X='00000000-0000-4000-8000-0000000000d4';
let n=0;const op=()=>'00000000-0000-4000-9000-'+String(++n).padStart(12,'0');
async function fixture(){
 const db=await createDb();await db.exec(SQL);
 const h=(await call(db,A,'hh_create',{p_name:'QA assign',p_display_name:'A'})).household.id;
 const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
 const other=(await call(db,X,'hh_create',{p_name:'other',p_display_name:'X'})).household.id;
 // Server-side: only households on the synthetic trial allowlist can use the feature.
 await db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) VALUES($1,'QA assign'),($2,'QA other')",[h,other]);
 const res=await call(db,A,'hh_push',{p_ops:[{op_id:op(),type:'create',kind:'buy',id:'buy_milk_0001',qty:1,fields:{name:'牛乳',unit:'本'},ts:Date.now()}]});
 assert.equal(res.results[0].status,'applied');
 const seq=async()=>Number((await db.query("SELECT seq FROM atokore_private.records WHERE id='buy_milk_0001'")).rows[0].seq);
 return {db,h,other,seq};
}
test('assign with expected revision; a stale view cannot overwrite; the row cursor moves for sync',async()=>{
 const {db,seq}=await fixture();const s0=await seq();
 assert.deepEqual(await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:B,p_expected_rev:0}),{status:'ready',rev:1,assignee:B,response:'pending'});
 assert.ok(await seq()>s0,'other devices see a changed cursor');
 const stale=await call(db,B,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:A,p_expected_rev:0});
 assert.equal(stale.status,'stale');assert.equal(stale.rev,1);assert.equal(stale.assignee,B);
 assert.equal((await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:B,p_expected_rev:1})).status,'unchanged');
 assert.deepEqual(await call(db,B,'hh_buy_assignments'),[{buy_id:'buy_milk_0001',assignee:B,requester:A,response:'pending',rev:1}]);
 const out=(await db.query('SELECT recipient,kind FROM atokore_private.notify_outbox')).rows;
 assert.deepEqual(out,[{recipient:B,kind:'assignment'}],'one generic queued notice, nothing sent');
});
test('replies: only the person asked, only once; 今回は難しい frees the row; 買えるよ keeps it',async()=>{
 const {db}=await fixture();
 await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:B,p_expected_rev:0});
 assert.equal((await call(db,A,'hh_buy_respond',{p_buy:'buy_milk_0001',p_decision:'accept',p_expected_rev:1})).status,'denied','requester cannot answer for them');
 assert.deepEqual(await call(db,B,'hh_buy_respond',{p_buy:'buy_milk_0001',p_decision:'decline',p_expected_rev:1}),{status:'ready',rev:2,response:'declined'});
 assert.equal((await call(db,B,'hh_buy_respond',{p_buy:'buy_milk_0001',p_decision:'accept',p_expected_rev:2})).status,'denied','no longer assigned');
 const now=await call(db,A,'hh_buy_assignments');assert.equal(now[0].assignee,null);assert.equal(now[0].response,'declined');
 // Re-asking after a decline is allowed, and accepting keeps it.
 await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:B,p_expected_rev:2});
 assert.equal((await call(db,B,'hh_buy_respond',{p_buy:'buy_milk_0001',p_decision:'accept',p_expected_rev:3})).response,'accepted');
 assert.equal((await call(db,B,'hh_buy_respond',{p_buy:'buy_milk_0001',p_decision:'accept',p_expected_rev:4})).status,'stale','a second reply is stale');
});
test('outsiders, leavers and deleted rows: denied or released, never leaked',async()=>{
 const {db}=await fixture();
 // Another household's member only ever sees their own household: the row does not exist for them.
 assert.equal((await call(db,X,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:X,p_expected_rev:0})).status,'gone');
 assert.deepEqual(await call(db,X,'hh_buy_assignments'),[]);
 assert.equal((await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:X,p_expected_rev:0})).status,'denied','other household member');
 assert.equal((await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:C,p_expected_rev:0})).status,'denied','not a member');
 await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:B,p_expected_rev:0});
 await call(db,A,'hh_remove_member',{p_user:B});
 assert.equal((await call(db,A,'hh_buy_assignments'))[0].assignee,null,'a removed member is nobody');
 await assert.rejects(call(db,B,'hh_buy_assignments'));
 await call(db,A,'hh_push',{p_ops:[{op_id:op(),type:'delete',kind:'buy',id:'buy_milk_0001',ts:Date.now()}]});
 assert.deepEqual(await call(db,A,'hh_buy_assignments'),[]);
 assert.equal((await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:A,p_expected_rev:1})).status,'gone');
 for(const role of ['anon','authenticated'])for(const t of ['buy_assignments','notify_outbox'])
  assert.equal((await db.query(`SELECT has_table_privilege('${role}','atokore_private.${t}','SELECT') ok`)).rows[0].ok,false);
});
test('SQL follows the reviewed JS policy on the same scenarios',async()=>{
 const {db,h}=await fixture();
 const members=[{id:A,householdId:h,active:true},{id:B,householdId:h,active:true}];
 const cases=[[B,null,0,'ready'],[B,B,1,'unchanged'],[null,B,1,'ready'],[A,null,2,'ready']];
 for(const [assignee,current,rev,want] of cases){
  const js=policy.assignmentPlan({householdId:h,buyId:'buy_milk_0001',actorId:A,assigneeId:assignee,currentAssigneeId:current,revision:rev,members}).status;
  const sql=(await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:assignee,p_expected_rev:rev})).status;
  assert.equal(js,want);assert.equal(sql,want,JSON.stringify({assignee,current,rev}));
 }
 assert.equal(policy.assignmentPlan({householdId:h,buyId:'b',actorId:A,assigneeId:'outsider',currentAssigneeId:null,revision:0,members}).status,'denied');
});

// Work 4th review: replies, leavers, the notice re-check and the synthetic-only allowlist.
test('replies: NULL, blank, padded, wrong-case and unknown words are invalid and change nothing',async()=>{
 const {db}=await fixture();
 await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:B,p_expected_rev:0});
 for(const d of [null,'',' ','accept ',' decline','ACCEPT','yes','承諾'])
  assert.equal((await call(db,B,'hh_buy_respond',{p_buy:'buy_milk_0001',p_decision:d,p_expected_rev:1})).status,'invalid',JSON.stringify(d));
 for(const [buy,rev] of [[null,1],['bad id',1],['buy_milk_0001',null],['buy_milk_0001',0],['buy_milk_0001',100000]])
  assert.equal((await call(db,B,'hh_buy_respond',{p_buy:buy,p_decision:'accept',p_expected_rev:rev})).status,'invalid',JSON.stringify([buy,rev]));
 const row=(await call(db,A,'hh_buy_assignments'))[0];
 assert.deepEqual([row.assignee,row.response,row.rev],[B,'pending',1]);
 assert.equal((await db.query("SELECT count(*)::int c FROM atokore_private.notify_outbox WHERE kind='assignment-response'")).rows[0].c,0);
});
test('a member who leaves loses their assignments and unsent notices at once; their own pending requests are withdrawn',async()=>{
 const {db,seq}=await fixture();
 await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:B,p_expected_rev:0});
 const s0=await seq();
 await call(db,B,'hh_leave',{});
 const raw=(await db.query("SELECT assignee,response,rev FROM atokore_private.buy_assignments")).rows[0];
 assert.deepEqual(raw,{assignee:null,response:'none',rev:2},'stored state is cleaned, not only hidden');
 assert.ok(await seq()>s0,'other phones refetch');
 const out=(await db.query("SELECT recipient,dropped_at IS NOT NULL dropped,drop_reason FROM atokore_private.notify_outbox")).rows;
 assert.deepEqual(out,[{recipient:B,dropped:true,drop_reason:'left'}]);
 // A pending request made by someone who then leaves is withdrawn (nobody could answer it).
 const {code}=await call(db,A,'hh_invite_create');await call(db,C,'hh_join',{p_code:code,p_display_name:'C'});
 await call(db,C,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:A,p_expected_rev:2});
 await call(db,A,'hh_remove_member',{p_user:C});
 assert.deepEqual((await db.query("SELECT assignee,response FROM atokore_private.buy_assignments")).rows[0],{assignee:null,response:'none'});
});
test('right before sending, a notice is dropped when the recipient left or it no longer matches; nothing is sent',async()=>{
 const {db}=await fixture();
 const due=async()=>(await db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query('SELECT atokore_private.notify_due_v51(50) r')).rows})).at(0).r;
 for(const role of ['anon','authenticated'])
  assert.equal((await db.query("SELECT has_function_privilege($1,'atokore_private.notify_due_v51(integer)','EXECUTE') ok",[role])).rows[0].ok,false);
 await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:B,p_expected_rev:0});
 assert.deepEqual((await due()).map(x=>[x.recipient,x.kind]),[[B,'assignment']]);
 // Taken back and asked again before the sender ran: the first notice is stale, the new one is due.
 await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:null,p_expected_rev:1});
 await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:B,p_expected_rev:2});
 assert.deepEqual((await due()).map(x=>[x.recipient,x.kind]),[[B,'assignment']]);
 // The recipient leaves between queueing and sending (bypassing the trigger, as a race would): dropped.
 await db.query("ALTER TABLE atokore_private.members DISABLE TRIGGER buy_assign_member_left_v51");
 await db.query("UPDATE atokore_private.members SET left_at=now() WHERE user_id=$1",[B]);
 await db.query("ALTER TABLE atokore_private.members ENABLE TRIGGER buy_assign_member_left_v51");
 assert.deepEqual(await due(),[]);
 const rows=(await db.query("SELECT recipient,drop_reason,sent_at FROM atokore_private.notify_outbox ORDER BY created_at")).rows;
 assert.deepEqual(rows.map(r=>[r.recipient,r.drop_reason,r.sent_at]),[[B,'stale',null],[B,'left',null]],'never marked sent');
});
test('only synthetic trial households: a real household gets not_enabled and nothing is stored',async()=>{
 const {db}=await fixture();
 const R='00000000-0000-4000-8000-0000000000e5';
 await call(db,R,'hh_create',{p_name:'real',p_display_name:'R'});
 await call(db,R,'hh_push',{p_ops:[{op_id:op(),type:'create',kind:'buy',id:'buy_real_0001',qty:1,fields:{name:'牛乳',unit:'本'},ts:Date.now()}]});
 assert.equal((await call(db,R,'hh_buy_assign',{p_buy:'buy_real_0001',p_assignee:R,p_expected_rev:0})).status,'not_enabled');
 assert.equal((await call(db,R,'hh_buy_respond',{p_buy:'buy_real_0001',p_decision:'accept',p_expected_rev:1})).status,'not_enabled');
 assert.deepEqual(await call(db,R,'hh_buy_assignments'),[]);
 assert.equal((await db.query("SELECT count(*)::int c FROM atokore_private.buy_assignments WHERE buy_id='buy_real_0001'")).rows[0].c,0);
 await assert.rejects(db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) SELECT id,'家族' FROM atokore_private.households WHERE name='real'"),/check/i);
});
