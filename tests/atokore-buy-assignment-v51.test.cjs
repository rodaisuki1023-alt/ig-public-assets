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
