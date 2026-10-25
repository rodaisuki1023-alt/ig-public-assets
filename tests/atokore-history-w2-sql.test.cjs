// W2 item 6 (server): history rows carry the record id, name the person as they were named at the
// time of the change, and leave the actor empty when it cannot be identified.
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDb,call}=require('./household/pg.cjs');
const A='00000000-0000-4000-8000-00000000000a',B='00000000-0000-4000-8000-00000000000b';
let n=1;const oid=()=>`20000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
const create=(id,name)=>({op_id:oid(),type:'create',kind:'item',id,fields:{name,unit:'袋'},qty:1,ts:Date.now()});
test('history rows include the record id and keep the name each person had at the time',async()=>{
 const db=await createDb();
 await call(db,A,'hh_create',{p_name:'わが家',p_display_name:'パパ'});
 let {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'ママ'});
 await call(db,B,'hh_push',{p_ops:[create('item-diaper-w2','おむつ M')]});
 // B leaves and joins again under another name; the earlier change stays with the earlier name.
 await call(db,B,'hh_leave');
 ({code}=await call(db,A,'hh_invite_create'));await call(db,B,'hh_join',{p_code:code,p_display_name:'おかあさん'});
 await new Promise(r=>setTimeout(r,5));
 await call(db,B,'hh_push',{p_ops:[{op_id:oid(),type:'add',kind:'item',id:'item-diaper-w2',delta:1}]});
 const rows=await call(db,A,'hh_changes');
 const created=rows.find(r=>r.type==='create'),added=rows.find(r=>r.type==='add');
 assert.equal(created.record_id,'item-diaper-w2');
 assert.equal(created.who,'ママ');
 assert.equal(added.who,'おかあさん');
 assert.equal(added.record_id,'item-diaper-w2');
});
test('an actor that cannot be identified is left empty (shown as 実行者不明), never guessed',async()=>{
 const db=await createDb();
 await call(db,A,'hh_create',{p_name:'わが家',p_display_name:'パパ'});
 await call(db,A,'hh_push',{p_ops:[create('item-milk-w2','牛乳')]});
 const hh=(await call(db,A,'hh_my')).household.id;
 await db.query("insert into atokore_private.ops(household_id,op_id,actor,device,type,kind,record_id,body,result) values($1,'30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000ff',null,'delete','item','item-milk-w2','{}'::jsonb,'applied')",[hh]);
 const row=(await call(db,A,'hh_changes')).find(r=>r.type==='delete');
 assert.equal(row.who,null);
 assert.equal(row.record_id,'item-milk-w2');
});
