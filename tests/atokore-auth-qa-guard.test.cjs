'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'manual/atokore-v50-auth-qa.html'),'utf8');
const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(js,'QA inline script must exist');

function load(origin='https://rodaisuki1023-alt.github.io',pathname='/ig-public-assets/tests/manual/atokore-v50-auth-qa.html'){
 const nodes={};
 for(const id of ['accounts','start','status','result'])nodes[id]={textContent:'',disabled:false,append(){},addEventListener(){}};
 const doc={getElementById(id){return nodes[id]||(nodes[id]={textContent:'',value:'',append(){}})},createElement(){return {append(){},value:'',readOnly:false}}};
 const state=new Map();
 const ctx={document:doc,location:{origin,pathname},console,
  localStorage:{getItem(k){return state.get(k)||null},setItem(k,v){state.set(k,v)}},
  fetch(){throw Error('No HTTP calls allowed in static QA verdict regression')}
 };
 vm.createContext(ctx);
 const exposed=js.replace(/\}\)\(\);\s*$/, 'globalThis.__verdict={rpcDenied,storageVerdict,photoMeta};})();');
 assert.notEqual(exposed,js,'QA verdict injection point missing');
 new vm.Script(exposed,{filename:'atokore-v50-auth-qa.html'}).runInContext(ctx);
 return {nodes,verdict:ctx.__verdict};
}
test('QA script parses, and third-party RawGithack is never allowed to collect test credentials',()=>{
 new vm.Script(js);
 const thirdParty=load('https://raw.githack.com','/rodaisuki1023-alt/ig-public-assets/test.html');
 assert.equal(thirdParty.nodes.start.disabled,true);
 assert.match(thirdParty.nodes.status.textContent,/このURLでは認証試験を実行できません/);
 assert.equal(load().nodes.start.disabled,false,'controlled Pages path permits test after authorized deployment');
});
test('RPC denial requires exact 403 AND 42501, not errors or fake success',()=>{
 const f=load().verdict.rpcDenied;
 assert.equal(f({status:403,data:{code:'42501'}}),true);
 for(const status of [0,200,400,401,404,409,429,500,503]){
  assert.equal(f({status,data:{code:'42501'}}),false,'unexpected pass HTTP '+status);
 }
 assert.equal(f({status:403,data:{code:'23505'}}),false);
 assert.equal(f({status:403,data:{}}),false);
});
test('Storage verdict rejects network and 5xx errors and requires an owner positive control',()=>{
 const f=load().verdict.storageVerdict;
 const owner={status:200};
 assert.equal(f({status:403},owner),'access_denied');
 assert.equal(f({status:401},owner),'access_denied');
 assert.equal(f({status:404,errorCode:'NoSuchKey'},owner),'hidden_existing_path');
 assert.equal(f({status:400,errorCode:'Object not found'},owner),'hidden_existing_path');
 assert.equal(f({status:404,errorCode:'NoSuchKey'},{status:503}),'unexpected');
 assert.equal(f({status:500,errorCode:'Permission denied'},owner),'unexpected');
 assert.equal(f({status:0,network:true,errorCode:'NoSuchKey'},owner),'unexpected');
 assert.equal(f({status:200},owner),'unexpected');
});
test('Review covers negative controls, separate histories, same-URL replay and cleanup',()=>{
 assert.match(html,/Bの履歴にAの商品IDがある/);
 assert.match(html,/別世帯CにAの商品履歴がない/);
 assert.match(html,/same-url-/);
 assert.match(html,/meta.fixedNonce,'default'/);
 assert.match(html,/除外後Bの新規URL取得拒否/);
 assert.match(html,/削除後Aの新規URLで画像不存在/);
 assert.match(html,/referrer" content="no-referrer"/);
 assert.match(html,/Content-Security-Policy/);
 assert.doesNotMatch(js,/createSignedUrl|getPublicUrl|service_role/);
 assert.doesNotMatch(js,/localStorage\.setItem\([^,\n]+,\s*.*access_token/);
});
