/**
 * Applies the NEW DRAFT proposal only to isolated PGlite, NEVER to real Supabase.
 * Tests actively forbid direct user Storage reads while confirming current
 * household membership / exact active item photo reference through an RPC.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createDb,call,asRole}=require('./household/pg.cjs');
const proposal=fs.readFileSync(path.join(__dirname,'../supabase/proposals/atokore-photo-gateway-v50.sql'),'utf8');
const A='00000000-0000-4000-8000-0000000000a1';
const B='00000000-0000-4000-8000-0000000000b2';
const C='00000000-0000-4000-8000-0000000000c3';
const newOp=(()=>{let n=0;return()=>('00000000-0000-4000-9000-'+String(++n).padStart(12,'0'))})();
const ph='00000000-0000-4000-9000-000000000099.jpg';
const recordId='item_picture_1';

async function state(){
  const db=await createDb();
  await db.exec(proposal);
  const created=await call(db,A,'hh_create',{p_name:'合成A',p_display_name:'A'});
  const own=(await call(db,A,'hh_my')).household;
  assert.ok(own?.id,JSON.stringify(created));
  const householdId=own.id;
  const photoPath=householdId+'/'+recordId+'/'+ph;
  const create={op_id:newOp(),type:'create',kind:'item',id:recordId,fields:{
    name:'合成写真商品',cat:'ベビー',unit:'袋'
  },qty:1,ts:Date.now()};
  const applied=await call(db,A,'hh_push',{p_ops:[create]});
  assert.equal(applied.results[0].status,'applied');
  const {code}=await call(db,A,'hh_invite_create');
  await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
  await call(db,C,'hh_create',{p_name:'合成C',p_display_name:'C'});
  const sql=async(uid,mode)=> (await asRole(db,uid,
    "select public.hh_photo_access('"+photoPath+"','"+mode+"') as ok"))[0]?.ok;
  return {db,householdId,photoPath,sql};
}

test('new bucket: directly cached URL can never be read by any end-user role',async()=>{
  const {db,photoPath}=await state();
  const bucket=(await db.query("select public from storage.buckets where id='atokore-private-photos-v2'")).rows[0];
  assert.equal(bucket.public,false);
  // Only postgres/storage service owns this synthetic object. Client has no policy.
  await db.query("insert into storage.objects(bucket_id,name) values($1,$2)",['atokore-private-photos-v2',photoPath]);
  for(const user of [A,B,C]){
    const visible=await asRole(db,user,
      "select count(*)::int as n from storage.objects where bucket_id='atokore-private-photos-v2'");
    assert.equal(visible[0].n,0);
  }
  await assert.rejects(asRole(db,null,
    "select count(*)::int as n from storage.objects where bucket_id='atokore-private-photos-v2'"),
    /permission denied/i);
  await assert.rejects(
    asRole(db,A,
      "insert into storage.objects(bucket_id,name) values('atokore-private-photos-v2','abc/some/path.jpg')"),
    /permission denied|row-level security/i
  );
});

test('per-call membership: write checks item, read checks current photoPath; B revoked',async()=>{
  const {db,photoPath,sql}=await state();
  assert.equal(await sql(A,'write'),true);
  assert.equal(await sql(B,'write'),true);
  assert.equal(await sql(C,'write'),false);
  await assert.rejects(sql(null,'write'),/permission denied/);
  assert.equal(await sql(A,'read'),false);
  assert.equal(await sql(B,'read'),false);
  const setPhoto={op_id:newOp(),type:'set',kind:'item',id:recordId,
    field:'photoPath',value:photoPath,ts:Date.now()+100};
  const saved=await call(db,A,'hh_push',{p_ops:[setPhoto]});
  assert.equal(saved.results[0].status,'applied');
  assert.equal(await sql(A,'read'),true);
  assert.equal(await sql(B,'read'),true);
  assert.equal(await sql(C,'read'),false);
  assert.equal(await sql(B,'delete'),true);
  await call(db,A,'hh_remove_member',{p_user:B});
  assert.equal(await sql(B,'read'),false);
  assert.equal(await sql(B,'write'),false);
  assert.equal(await sql(B,'delete'),false);
  assert.equal(await sql(A,'read'),true);
  assert.equal(await sql(A,'delete'),true);
});

test('inactive item and forged object path cannot pass authorization',async()=>{
  const {db,householdId,photoPath,sql}=await state();
  assert.equal(await sql(A,'write'),true);
  const fake=householdId+'/not-a-real-record/'+ph;
  const forged=await asRole(db,A,"select public.hh_photo_access('"+fake+"','write') as ok");
  assert.equal(forged[0].ok,false);
  const invalid=await asRole(db,A,"select public.hh_photo_access('"+photoPath+"?v=1','read') as ok");
  assert.equal(invalid[0].ok,false);
  const op={op_id:newOp(),type:'delete',kind:'item',id:recordId,ts:Date.now()+900};
  await call(db,A,'hh_push',{p_ops:[op]});
  assert.equal(await sql(A,'write'),false);
});
