// Work 8th (A): every way of deleting a photo object goes through ONE gate (photo-delete-gate-v51.mjs:
// the adapter must declare and implement a generation-conditional delete and an authoritative absence
// check; the database fences the key first). The v50 helper that removed retired photos directly
// (purgeRetired) deleted once with an adapter that has no conditional delete; it now never deletes.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'..');
const v50=import('../supabase/proposals/photo-general-v50.mjs');
const F='11111111-1111-4111-8111-111111111111',H='22222222-2222-4222-8222-222222222222',P=H+'/item_abcdefgh/'+F+'.jpg';
test('A (Work 8th): the v50 retired-photo helper never deletes, whatever the adapter (no capability, plain remove)',async()=>{
 const m=await v50;let removed=0,claimed=0;
 const worker=async(action)=>{if(action==='claim_purge'){claimed++;return {path:P}}return {ok:true}};
 for(const storage of [{remove:async()=>{removed++}},{remove:async()=>{removed++},capabilities:{}},{remove:async()=>{removed++},capabilities:{conditionalRemove:true}}]){
  const r=await m.purgeRetired({worker,storage},F);
  assert.equal(r,false,'held: destructive purge only through the gated worker');
 }
 assert.equal(removed,0,'no Storage delete');
 assert.equal(claimed,0,'not even claimed (nothing left half-done)');
});
// Static inventory: no file outside the gate deletes Storage objects. Allowed, with reasons:
const ALLOWED={
 'supabase/proposals/photo-delete-gate-v51.mjs':'the gate itself (conditional delete only)',
 'supabase/functions/_shared/photo-gateway-handler.mjs':'v44 QA gateway handler: receives removeObject from its adapter',
 'supabase/functions/atokore-photo-gateway/index.ts':'v44 QA-only Edge Function: one fixed synthetic QA object, off by default',
};
const PATTERNS=[/\bstorage\s*\.\s*remove\s*\(/,/\.storage\.from\([^)]*\)\s*\.\s*remove\s*\(/,/\bremoveIfGeneration\s*\(/,/\bremoveObject\s*\(/,/delete\s+from\s+storage\.objects/i,/storage\/v1\/object\/[^'"`]*['"`]\s*,\s*\{[^}]*method\s*:\s*['"]DELETE/i];
function files(dir){const out=[];for(const e of fs.readdirSync(path.join(ROOT,dir),{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(!['node_modules','.git','tests'].includes(e.name))out.push(...files(p))}else if(/\.(m?js|cjs|ts|sql|py)$/.test(e.name))out.push(p)}return out}
test('A (Work 8th): inventory — no Storage delete outside the gate (worker, purge, orphan, migration, Edge, SQL, scripts, app)',()=>{
 const found=[];
 for(const dir of ['supabase','atokore-live-v125','scripts']){
  for(const f of files(dir)){
   const text=fs.readFileSync(path.join(ROOT,f),'utf8').split('\n').filter(l=>!/^\s*(\/\/|\*|--|#)/.test(l)).join('\n');
   if(PATTERNS.some(r=>r.test(text))&&!ALLOWED[f.replace(/\\/g,'/')])found.push(f);
  }
 }
 assert.deepEqual(found.filter(f=>!/receipt-audit\//.test(f)),[],'a Storage delete outside the single gate');
});
test('A (Work 8th): reachability — the shipped app has photo sharing off; the QA gateway is not reachable from it',()=>{
 const cfg=fs.readFileSync(path.join(ROOT,'atokore-live-v125/household-config-v37.js'),'utf8');
 assert.match(cfg,/photoGatewayEnabled:\s*false/);
 assert.match(cfg,/photoGatewayProtocol:\s*2/,'protocol 2 = the general gateway, whose delete only detaches the reference');
 const gen=fs.readFileSync(path.join(ROOT,'supabase/proposals/photo-general-v50.mjs'),'utf8');
 const del=gen.slice(gen.indexOf("if(op==='delete'){"),gen.indexOf("const r=await readVerified"));
 assert.doesNotMatch(del,/storage\.|remove\(/,'the general gateway delete never touches Storage');
});
