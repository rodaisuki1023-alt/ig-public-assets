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
 const day=(await db.query('SELECT current_date::text d')).rows[0].d;
 return {db,day};
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
test('ticks are idempotent per day and row, removable, and old days are cleaned',async()=>{
 const {db,day}=await fixture();
 for(let i=0;i<2;i++)assert.equal((await call(db,A,'hh_prep_tick',{p_day:day,p_instance:'["d","c-a","w1"]',p_done:true})).status,'ready');
 await call(db,B,'hh_prep_tick',{p_day:day,p_instance:'["d","c-a","w2"]',p_done:true});
 assert.deepEqual((await call(db,B,'hh_prep_get',{p_day:day})).ticks,['["d","c-a","w1"]','["d","c-a","w2"]']);
 await call(db,A,'hh_prep_tick',{p_day:day,p_instance:'["d","c-a","w2"]',p_done:false});
 assert.deepEqual((await call(db,A,'hh_prep_get',{p_day:day})).ticks,['["d","c-a","w1"]']);
 assert.equal((await call(db,A,'hh_prep_tick',{p_day:'2020-01-01',p_instance:'x',p_done:true})).status,'invalid');
 await db.query("INSERT INTO atokore_private.prep_ticks(household_id,day,instance,updated_by) SELECT household_id,current_date-5,'old',updated_by FROM atokore_private.prep_ticks LIMIT 1");
 await call(db,A,'hh_prep_tick',{p_day:day,p_instance:'y',p_done:true});
 assert.equal((await db.query("SELECT count(*)::int n FROM atokore_private.prep_ticks WHERE instance='old'")).rows[0].n,0);
});
test('a removed member loses access at once; tables are not client-readable',async()=>{
 const {db,day}=await fixture();
 await call(db,A,'hh_remove_member',{p_user:B});
 await assert.rejects(call(db,B,'hh_prep_get',{p_day:day}));
 await assert.rejects(call(db,B,'hh_prep_tick',{p_day:day,p_instance:'x',p_done:true}));
 for(const role of ['anon','authenticated'])for(const t of ['prep_docs','prep_ticks'])
  assert.equal((await db.query(`SELECT has_table_privilege('${role}','atokore_private.${t}','SELECT') ok`)).rows[0].ok,false);
});
