'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'manual/atokore-v50-photo-gateway-qa.html'),'utf8');
const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(js);
const origin='https://atokore-v50-owner-review-20261122.vercel.app',route='/qa/atokore-v50-photo-gateway-qa.html';
const marker='atk_v50_qa_once_f8a63d1e92';
function load(o=origin,p=route,seed=[],failStorage=false){
 const fixed={},created=[],requests=[],state=new Map(seed);
 const node=()=>({textContent:'',value:'',disabled:false,hidden:false,attributes:{},
   append(){},addEventListener(){},setAttribute(k,v){this.attributes[k]=v},focus(){}});
 for(const id of ['accounts','start','status','result'])fixed[id]=node();
 const doc={getElementById(id){return fixed[id]||created.find(x=>x.id===id)||null},
 createElement(){const n=node();created.push(n);return n}};
 const sandbox={document:doc,location:{origin:o,pathname:p},console,
 localStorage:{getItem(k){return state.get(k)||null},setItem(k,v){if(failStorage)throw Error('full');state.set(k,v)}},
 fetch(url){requests.push(url);throw Error('isolated mock: real network prohibited')}};
 const injected=js.replace(/\}\)\(\);\s*$/, 'globalThis.__qa={start,denied,directDenied,isMatch,safePath};})();');
 assert.notEqual(injected,js);
 vm.createContext(sandbox);new vm.Script(injected).runInContext(sandbox);
 const credentials=()=>['a','b','c'].forEach(r=>{doc.getElementById('password-'+r).value='synthetic-mock-pass-'+r});
 return {fixed,doc,requests,state,qa:sandbox.__qa,credentials};
}
test('only exact protected origin/path allows QA; all others perform zero HTTP',async()=>{
 for(const [o,p] of [['https://raw.githack.com',route],[origin,'/'],[origin,route+'/'],[origin+'/fake',route]]){
  const q=load(o,p);q.credentials();await q.qa.start();
  assert.equal(q.fixed.start.disabled,true);assert.equal(q.requests.length,0);
 }
 assert.equal(load().fixed.start.disabled,false);
});
test('one-shot marker never resets and storage failure prevents Auth',async()=>{
 const q=load(origin,route,[[marker,'previous run']]);q.credentials();await q.qa.start();
 assert.equal(q.requests.length,0);assert.equal(q.state.get(marker),'previous run');
 const fail=load(origin,route,[],true);fail.credentials();await fail.qa.start();
 assert.equal(fail.requests.length,0);assert.equal(fail.state.size,0);
 const missing=load();await missing.qa.start();assert.equal(missing.requests.length,0);
 missing.credentials();missing.doc.getElementById('email-b').value='real-user@example.com';
 await missing.qa.start();assert.equal(missing.requests.length,0);
});
test('valid synthetic inputs consume run marker before first attempted request',async()=>{
 const q=load();q.credentials();await q.qa.start();
 assert.equal(q.requests.length,1);assert.ok(q.state.has(marker));
 assert.ok(q.requests[0].endsWith('/auth/v1/token?grant_type=password'));
 assert.ok(!JSON.stringify([...q.state]).includes('synthetic-mock-pass'));
 await q.qa.start();assert.equal(q.requests.length,1);
});
test('revocation is exact 403 denied, not network failure, bad JWT, wrong origin or server crash',()=>{
 const f=load().qa.denied;
 assert.equal(f({status:403,image:false,data:{error:'denied'}}),true);
 for(const v of [{status:0},{status:401},{status:403,data:{error:'origin'}},{status:404},{status:503},{status:200,image:true},{status:403,image:true,data:{error:'denied'}}])assert.equal(f(v),false);
 const d=load().qa.directDenied;
 assert.equal(d({status:400,data:{message:'Object not found'}}),true);
 assert.equal(d({status:403}),true);
 for(const v of [{status:400,data:{message:'bad request'}},{status:401},{status:0},{status:503},{status:200,image:true}])assert.equal(d(v),false);
});
test('positive control requires exact bytes/hash/no-store, and paths are cohort-scoped',()=>{
 const f=load().qa,sha='synthetic-hash';
 const response={status:200,image:true,hash:sha,bytes:773,cache:'private, no-store'};
 assert.equal(f.isMatch(response,sha,773),true);
 for(const bad of [{...response,hash:'wrong'},{...response,bytes:1},{...response,cache:'public'},{...response,status:403}])assert.equal(f.isMatch(bad,sha,773),false);
 const hh='00000000-0000-4000-8000-0000000000a1',uid='00000000-0000-4000-8000-0000000000c3';
 const valid=hh+'/qa_f8a63d1e92_item/'+uid+'.jpg';
 assert.equal(f.safePath(valid,hh),true);
 assert.equal(f.safePath(valid,uid),false);
 assert.equal(f.safePath(valid.replace('f8a63d1e92','d59b5fa73f'),hh),false);
 assert.equal(f.safePath(valid+'?x=1',hh),false);
});
test('QA is new bucket only; no secret or legacy routes or signup',()=>{
 assert.match(html,/NEW_BUCKET='atokore-private-photos-v2'/);
 assert.doesNotMatch(html,/atokore-product-photos|sb_secret_|service_role|\/auth\/v1\/signup/);
 assert.match(html,/除外後Bの同一POST・旧JWT拒否/);
 assert.match(html,/除外後Bの同一POST・新JWT拒否/);
 assert.match(html,/B拒否後もAの写真が維持/);
 assert.match(html,/CのJWT有効・別世帯在庫分離/);
});
