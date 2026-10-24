const test=require('node:test');
const assert=require('node:assert/strict');
const {inverseCounters,stockLabel}=require('../atokore-live-v125/polish-v44.js');
const {createDb,call,asRole}=require('./household/pg.cjs');
const A='00000000-0000-4000-8000-00000000000a',B='00000000-0000-4000-8000-00000000000b',C='00000000-0000-4000-8000-00000000000c';
let n=1;const oid=()=>`10000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
const make=(kind,id,qty,extra={})=>({op_id:oid(),type:'create',kind,id,fields:{name:'粉ミルク',unit:'缶',...extra},qty,ts:Date.now()});
const pull=async db=>Object.fromEntries((await call(db,A,'hh_pull',{p_since:0})).records.map(x=>[x.id,x]));
async function pair(){const db=await createDb();await call(db,A,'hh_create',{p_name:'家族',p_display_name:'親'});const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'家族'});return db}
test('counter undo preserves a later family increment and rejects deletion or negative stock',()=>{
 const current={items:[{id:1,name:'ミルク',qty:6,unit:'缶',place:'家族が変えた場所',usage:4}],buys:[],routines:[]};
 const changes=[{key:'items',id:1,name:'ミルク',unit:'缶',delta:1}];
 const next=inverseCounters(current,changes);assert.equal(next.items[0].qty,5);assert.equal(next.items[0].place,'家族が変えた場所');assert.equal(current.items[0].qty,6);
 assert.throws(()=>inverseCounters({...current,items:[]},changes));assert.throws(()=>inverseCounters({...current,items:[{...current.items[0],qty:0}]},changes));
 assert.equal(stockLabel({qty:2,unit:'袋',qtyBasis:'unopened',inUse:true}),'未開封 2袋・使用中あり');
});
test('acknowledged purchase undo is atomic, once, scoped to actor, and preserves later changes',async()=>{
 const db=await pair();
 try{
  await call(db,A,'hh_push',{p_ops:[make('item','item-milk-v44',3),make('buy','buy-milk-v44',2)]});
  const done={op_id:oid(),type:'complete_buy',buy:'buy-milk-v44',item:'item-milk-v44',delta:2};
  await call(db,A,'hh_push',{p_ops:[done]});
  await call(db,B,'hh_push',{p_ops:[{op_id:oid(),type:'add',kind:'item',id:'item-milk-v44',delta:1},{op_id:oid(),type:'set',kind:'item',id:'item-milk-v44',field:'place',value:'棚',ts:Date.now()}]});
  await assert.rejects(call(db,B,'hh_undo_purchases',{p_ops:[done.op_id]}),/purchase_not_reversible/);
  assert.equal((await call(db,A,'hh_undo_purchases',{p_ops:[done.op_id]})).undone,1);
  let state=await pull(db);assert.equal(state['item-milk-v44'].qty,4);assert.equal(state['item-milk-v44'].fields.place,'棚');assert.equal(state['buy-milk-v44'].deleted,false);
  assert.equal((await call(db,A,'hh_undo_purchases',{p_ops:[done.op_id]})).undone,0);assert.equal((await pull(db))['item-milk-v44'].qty,4);
  const history=await call(db,A,'hh_changes');const purchase=history.find(x=>x.type==='complete_buy');assert.equal(purchase.name,'粉ミルク');assert.equal(purchase.unit,'缶');
  const add=history.find(x=>x.type==='add');assert.equal(add.beforeQty,5);assert.equal(add.afterQty,6);
  await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'set',kind:'item',id:'item-milk-v44',field:'name',value:'名前を変更',ts:Date.now()+100}]});
  assert.equal((await call(db,A,'hh_changes')).find(x=>x.type==='complete_buy').name,'粉ミルク');
 }finally{await db.close()}
});
test('undo rejects stock already used up and rolls back the whole batch; client cannot forge receipts',async()=>{
 const db=await pair();
 try{
  await call(db,A,'hh_push',{p_ops:[make('item','item-milk-v44',1),make('buy','buy-milk-v44',2)]});
  const done={op_id:oid(),type:'complete_buy',buy:'buy-milk-v44',item:'item-milk-v44',delta:2,_itemBefore:99999,_undo_done:true};
  await call(db,A,'hh_push',{p_ops:[done]});
  await call(db,B,'hh_push',{p_ops:[{op_id:oid(),type:'add',kind:'item',id:'item-milk-v44',delta:-3}]});
  await assert.rejects(call(db,A,'hh_undo_purchases',{p_ops:[done.op_id]}),/purchase_changed/);
  assert.equal((await pull(db))['buy-milk-v44'].deleted,true);
  await call(db,B,'hh_push',{p_ops:[{op_id:oid(),type:'add',kind:'item',id:'item-milk-v44',delta:4}]});
  assert.equal((await call(db,A,'hh_undo_purchases',{p_ops:[done.op_id]})).undone,1);assert.equal((await pull(db))['item-milk-v44'].qty,2);
 }finally{await db.close()}
});
test('photo RLS permits invited guests, denies nonmembers, cross-household paths and removed members',async()=>{
 const db=await pair();
 try{
  const {household}=await call(db,A,'hh_my');await call(db,A,'hh_push',{p_ops:[make('item','item-milk-v44',2)]});
  const name=household.id+'/item-milk-v44/'+oid()+'.jpg';
  await asRole(db,A,"insert into storage.objects(bucket_id,name) values('atokore-product-photos','"+name+"')");
  assert.equal((await asRole(db,B,'select name from storage.objects')).length,1);
  assert.equal((await asRole(db,C,'select name from storage.objects')).length,0);
  await assert.rejects(asRole(db,C,"insert into storage.objects(bucket_id,name) values('atokore-product-photos','"+household.id+'/item-milk-v44/'+oid()+".jpg')"),/row-level security/);
  await call(db,A,'hh_remove_member',{p_user:B});assert.equal((await asRole(db,B,'select name from storage.objects')).length,0);
  await assert.rejects(asRole(db,null,'select name from storage.objects'),/permission denied/);
 }finally{await db.close()}
});
