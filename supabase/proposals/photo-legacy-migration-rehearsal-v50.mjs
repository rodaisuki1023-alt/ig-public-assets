// DRAFT: privileged adapter contract; no credentials, no real DB/Storage calls.
// Copies only after explicit scope/expected digest. Does not change the record,
// delete the legacy object or claim a successful migration. Caller must execute
// a separately audited transactional CAS that registers the new ledger row.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id=v=>typeof v==='string'&&v.length===36&&UUID.test(v);
const digest=v=>typeof v==='string'&&v.length===64&&/^[0-9a-f]{64}$/.test(v);
const record=v=>typeof v==='string'&&!/\s/.test(v)&&/^[A-Za-z0-9_-]{8,64}$/.test(v);
const safe=(p,h,r)=>typeof p==='string'&&p.startsWith(h+'/'+r+'/')&&p.endsWith('.jpg')&&id(p.slice((h+'/'+r+'/').length,-4));
async function hash(b){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('')}
const bounded=b=>b instanceof Uint8Array&&b.length>3&&b.length<=81920&&b[0]===255&&b[1]===216&&b.at(-2)===255&&b.at(-1)===217;
export async function stageLegacyCopy({approved,household,recordId,expectedSeq,oldPath,oldSha,newPath},adapters){
 if(approved!==true||!id(household)||!record(recordId)||!Number.isSafeInteger(expectedSeq)||expectedSeq<0||
 !safe(oldPath,household,recordId)||!safe(newPath,household,recordId)||oldPath===newPath||!digest(oldSha))
  throw Error('migration_scope');
 const same=row=>row?.seq===expectedSeq&&row?.photoPath===oldPath&&row.deleted===false;
 if(!same(await adapters.current(household,recordId)))throw Error('migration_stale');
 const original=await adapters.downloadLegacy(oldPath);
 if(!bounded(original)||await hash(original)!==oldSha)throw Error('migration_source_mismatch');
 const clean=adapters.normalize(original);
 if(!bounded(clean))throw Error('migration_invalid_jpeg');
 const sha=await hash(clean);
 // The write adapter must persist a quota reservation and operation journal
 // before any upload, use upsert:false, and refuse an unowned existing path.
 // Ambiguous remote outcomes are not a successful copy.
 await adapters.stageReserved(newPath,clean,{sha,household,recordId,expectedSeq,oldPath});
 const stored=await adapters.downloadStaged(newPath);
 if(!bounded(stored)||stored.length!==clean.length||await hash(stored)!==sha)throw Error('migration_copy_mismatch');
 if(!same(await adapters.current(household,recordId)))throw Error('migration_stale_after_copy');
 return {state:'ready_for_separate_cas',household,recordId,expectedSeq,oldPath,oldSha,newPath,sha,bytes:stored.length};
}
