const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),jpeg=require('jpeg-js');
const H='11111111-1111-4111-8111-111111111111',R='qa_migration_item',P=H+'/'+R+'/22222222-2222-4222-8222-222222222222.jpg',N=H+'/'+R+'/33333333-3333-4333-8333-333333333333.jpg';
const original=Uint8Array.from(jpeg.encode({width:8,height:8,data:Buffer.alloc(256,200)},80).data);
const plan={approved:true,household:H,recordId:R,expectedSeq:9,oldPath:P,oldSha:createHash('sha256').update(original).digest('hex'),newPath:N};
const fixture=async()=>{
 const m=await import('../supabase/proposals/photo-general-v50.mjs');
 const {stageLegacyCopy}=await import('../supabase/proposals/photo-legacy-migration-rehearsal-v50.mjs');
 let calls=[],staged,row={seq:9,photoPath:P,deleted:false};
 const a={current:async()=>row,downloadLegacy:async p=>{calls.push('read');assert.equal(p,P);return original},
  normalize:m.makeJpegNormalizer(jpeg),stageReserved:async(p,b)=>{calls.push('copy');assert.equal(p,N);staged=b},
  downloadStaged:async()=>staged};
 return {stageLegacyCopy,a,calls,stale:()=>row={...row,seq:10}};
};
test('legacy rehearsal copies and verifies bytes but never changes or deletes a record',async()=>{
 const f=await fixture(),x=await f.stageLegacyCopy(plan,f.a);
 assert.equal(x.state,'ready_for_separate_cas');assert.equal(x.oldPath,P);assert.equal(x.newPath,N);
 assert.deepEqual(f.calls,['read','copy']);assert.equal((await f.a.current()).photoPath,P);
});
test('legacy rehearsal refuses unapproved/foreign paths, changed row, corrupt source and changed copy',async()=>{
 const f=await fixture();
 for(const p of [{...plan,approved:false},{...plan,newPath:N+'\n'},{...plan,newPath:P},{...plan,oldSha:'b'.repeat(64)}])await assert.rejects(f.stageLegacyCopy(p,f.a));
 assert.deepEqual(f.calls,['read']);
 f.a.downloadStaged=async()=>Uint8Array.from([255,216,255,217]);
 await assert.rejects(f.stageLegacyCopy(plan,f.a),/migration_copy_mismatch/);
 f.stale();await assert.rejects(f.stageLegacyCopy(plan,f.a),/migration_stale/);
});
test('a concurrent edit after copy holds migration and does not delete the original',async()=>{
 const f=await fixture(),stage=f.a.stageReserved;
 f.a.stageReserved=async(...args)=>{await stage(...args);f.stale()};
 await assert.rejects(f.stageLegacyCopy(plan,f.a),/migration_stale_after_copy/);
 assert.equal((await f.a.current()).photoPath,P);
});
