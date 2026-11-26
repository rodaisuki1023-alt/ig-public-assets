// v51 draft: shared preparation settings (revisioned) and ticks (idempotent). Isolated PGlite only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {createDb,call}=require('./household/pg.cjs');
const SQL=fs.readFileSync(path.join(__dirname,'../supabase/proposals/atokore-prep-share-v51.sql'),'utf8');
const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b2',X='00000000-0000-4000-8000-0000000000d4';
const doc=name=>({v:1,children:[{id:'c-a',name}],week:{},events:{}});
async function fixture(){
 const db=await createDb();await db.exec(SQL);
 await call(db,A,'hh_create',{p_name:'QA prep',p_display_name:'A'});
 const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
 await call(db,X,'hh_create',{p_name:'other',p_display_name:'X'});
 // Server-side: synthetic trial households only.
 await db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) SELECT id,'QA '||name FROM atokore_private.households");
 const {day,dow}=(await db.query("SELECT current_date::text AS day,extract(dow FROM current_date)::int::text AS dow")).rows[0];
 return {db,day,dow};
}
test('settings: revision prevents a silent overwrite; members read the same document',async()=>{
 const {db,day}=await fixture();
 assert.deepEqual(await call(db,A,'hh_prep_get',{p_day:day}),{doc:null,rev:0,ticks:[]});
 assert.deepEqual(await call(db,A,'hh_prep_put',{p_doc:doc('上の子'),p_expected_rev:0}),{status:'ready',rev:1});
 assert.deepEqual(await call(db,B,'hh_prep_put',{p_doc:doc('別の名前'),p_expected_rev:0}),{status:'stale',rev:1});
 const got=await call(db,B,'hh_prep_get',{p_day:day});assert.equal(got.doc.children[0].name,'上の子');assert.equal(got.rev,1);
 assert.equal((await call(db,B,'hh_prep_put',{p_doc:doc('上の子2'),p_expected_rev:1})).rev,2);
 assert.equal((await call(db,X,'hh_prep_get',{p_day:day})).doc,null,'another household sees nothing');
});
test('shape checks: ticks or more than four children are refused; oversize refused',async()=>{
 const {db}=await fixture();
 for(const bad of [{v:2,children:[]},{v:1,children:[1,2,3,4,5].map(i=>({id:'c'+i,name:'x'}))},{...doc('a'),done:{}},{v:1,children:[],week:{big:'x'.repeat(21000)}}])
  assert.equal((await call(db,A,'hh_prep_put',{p_doc:bad,p_expected_rev:0})).status,'invalid');
});
// A document with today's weekly rows and an event today; tick ids are [day, child, row] like the app.
const withRows=(day,dow)=>({v:1,children:[{id:'c-a',name:'上の子',place:'さくら園'}],week:{'c-a':{[dow]:[{id:'w1',name:'おむつ'},{id:'w2',name:'着替え'}]}},events:{'c-a':{[day]:{label:'遠足',rows:[{id:'e1',name:'お弁当'}]}}}});
const inst=(day,row)=>JSON.stringify([day,'c-a',row]);
test('ticks are idempotent per day and row, removable, and old days are cleaned',async()=>{
 const {db,day,dow}=await fixture();
 await call(db,A,'hh_prep_put',{p_doc:withRows(day,dow),p_expected_rev:0});
 for(let i=0;i<2;i++)assert.equal((await call(db,A,'hh_prep_tick',{p_day:day,p_instance:inst(day,'w1'),p_done:true})).status,'ready');
 await call(db,B,'hh_prep_tick',{p_day:day,p_instance:inst(day,'e1'),p_done:true});
 assert.deepEqual((await call(db,B,'hh_prep_get',{p_day:day})).ticks,[inst(day,'e1'),inst(day,'w1')].sort());
 await call(db,A,'hh_prep_tick',{p_day:day,p_instance:inst(day,'e1'),p_done:false});
 assert.deepEqual((await call(db,A,'hh_prep_get',{p_day:day})).ticks,[inst(day,'w1')]);
 assert.equal((await call(db,A,'hh_prep_tick',{p_day:'2020-01-01',p_instance:inst('2020-01-01','w1'),p_done:true})).status,'invalid');
 await db.query("INSERT INTO atokore_private.prep_ticks(household_id,day,instance,updated_by) SELECT household_id,current_date-5,'old',updated_by FROM atokore_private.prep_ticks LIMIT 1");
 await call(db,A,'hh_prep_tick',{p_day:day,p_instance:inst(day,'w2'),p_done:true});
 assert.equal((await db.query("SELECT count(*)::int n FROM atokore_private.prep_ticks WHERE instance='old'")).rows[0].n,0);
});
// Work 4th review: the whole document is validated on the server, and ticks must name real rows.
test('document: missing fields, blank names, bad or duplicate ids, rows for unknown children, unknown keys and bad dates are refused',async()=>{
 const {db,day,dow}=await fixture();
 const good=withRows(day,dow);
 assert.equal((await call(db,A,'hh_prep_put',{p_doc:good,p_expected_rev:0})).status,'ready');
 const bad={
  missing_week:{v:1,children:[],events:{}},missing_children:{v:1,week:{},events:{}},
  blank_child:{...good,children:[{id:'c-a',name:'   '}]},
  blank_row:{...good,week:{'c-a':{[dow]:[{id:'w1',name:' '}]}}},
  bad_child_id:{...good,children:[{id:'c a<script>',name:'上の子'}],week:{},events:{}},
  missing_child_id:{...good,children:[{name:'上の子'}],week:{},events:{}},
  duplicate_child:{...good,children:[{id:'c-a',name:'上'},{id:'c-a',name:'下'}]},
  duplicate_row:{...good,week:{'c-a':{[dow]:[{id:'w1',name:'a'},{id:'w1',name:'b'}]}}},
  unknown_child_rows:{...good,week:{'c-zz':{[dow]:[{id:'w1',name:'おむつ'}]}}},
  unknown_child_event:{...good,events:{'c-zz':{[day]:{rows:[{id:'e1',name:'x'}]}}}},
  unknown_key:{...good,owner:'someone'},
  unknown_row_key:{...good,week:{'c-a':{[dow]:[{id:'w1',name:'a',qty:999}]}}},
  bad_weekday:{...good,week:{'c-a':{'7':[{id:'w1',name:'a'}]}}},
  bad_event_day:{...good,events:{'c-a':{'2026-02-30':{rows:[{id:'e1',name:'x'}]}}}},
  long_place:{...good,children:[{id:'c-a',name:'上の子',place:'x'.repeat(21)}]},
  ticks_inside:{...good,done:{}}};
 for(const [why,doc] of Object.entries(bad)){
  const r=await call(db,A,'hh_prep_put',{p_doc:doc,p_expected_rev:1});
  assert.equal(r.status,'invalid',why);
 }
 for(const rev of [null,-1,100000])assert.equal((await call(db,A,'hh_prep_put',{p_doc:good,p_expected_rev:rev})).status,'invalid');
 assert.equal((await call(db,A,'hh_prep_get',{p_day:day})).rev,1,'nothing was stored');
});
test('ticks: made-up rows, another household\'s rows, the wrong day and malformed ids are refused',async()=>{
 const {db,day,dow}=await fixture();
 await call(db,A,'hh_prep_put',{p_doc:withRows(day,dow),p_expected_rev:0});
 const other={v:1,children:[{id:'c-x',name:'よその子'}],week:{'c-x':{[dow]:[{id:'wx',name:'おむつ'}]}},events:{}};
 await call(db,X,'hh_prep_put',{p_doc:other,p_expected_rev:0});
 const tries={made_up:inst(day,'w9'),other_household:JSON.stringify([day,'c-x','wx']),other_child:JSON.stringify([day,'c-x','w1']),
  wrong_day:JSON.stringify(['2000-01-01','c-a','w1']),not_json:'w1',object:JSON.stringify({day,row:'w1'}),short:JSON.stringify([day,'c-a'])};
 for(const [why,p] of Object.entries(tries))
  assert.equal((await call(db,A,'hh_prep_tick',{p_day:day,p_instance:p,p_done:true})).status,'invalid',why);
 assert.deepEqual((await call(db,A,'hh_prep_get',{p_day:day})).ticks,[]);
 assert.equal((await call(db,X,'hh_prep_tick',{p_day:day,p_instance:JSON.stringify([day,'c-x','wx']),p_done:true})).status,'ready','its own row works');
});
test('only synthetic trial households: a real household gets not_enabled and nothing is stored',async()=>{
 const {db,day}=await fixture();
 const R='00000000-0000-4000-8000-0000000000e5';
 await call(db,R,'hh_create',{p_name:'real',p_display_name:'R'});
 assert.equal((await call(db,R,'hh_prep_put',{p_doc:doc('上の子'),p_expected_rev:0})).status,'not_enabled');
 assert.equal((await call(db,R,'hh_prep_get',{p_day:day})).status,'not_enabled');
 assert.equal((await call(db,R,'hh_prep_tick',{p_day:day,p_instance:'["x","y","z"]',p_done:true})).status,'not_enabled');
 assert.equal((await db.query("SELECT count(*)::int c FROM atokore_private.prep_docs d JOIN atokore_private.households h ON h.id=d.household_id WHERE h.name='real'")).rows[0].c,0);
});
test('a removed member loses access at once; tables are not client-readable',async()=>{
 const {db,day}=await fixture();
 await call(db,A,'hh_remove_member',{p_user:B});
 await assert.rejects(call(db,B,'hh_prep_get',{p_day:day}));
 await assert.rejects(call(db,B,'hh_prep_tick',{p_day:day,p_instance:'x',p_done:true}));
 for(const role of ['anon','authenticated'])for(const t of ['prep_docs','prep_ticks'])
  assert.equal((await db.query(`SELECT has_table_privilege('${role}','atokore_private.${t}','SELECT') ok`)).rows[0].ok,false);
});
