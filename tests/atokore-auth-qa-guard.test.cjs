'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'manual/atokore-v50-auth-qa.html'),'utf8');
const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(js,'QA inline script must exist');

function load(origin='https://rodaisuki1023-alt.github.io',pathname='/ig-public-assets/tests/manual/atokore-v50-auth-qa.html',seed=[]){
 const nodes={},created=[],state=new Map(seed),requests=[];
 const elt=()=>({
  textContent:'',value:'',disabled:false,hidden:false,attributes:{},
  append(){},addEventListener(){},
  setAttribute(k,v){this.attributes[k]=v},
  focus(){this.focused=true}
 });
 for(const id of ['accounts','start','status','result'])nodes[id]=elt();
 const doc={
  getElementById(id){return nodes[id]||created.find(x=>x.id===id)||null},
  createElement(){const obj=elt();created.push(obj);return obj}
 };
 const ctx={document:doc,location:{origin,pathname},console,
  localStorage:{
   getItem(k){return state.get(k)||null},
   setItem(k,v){state.set(k,v)},
   removeItem(k){state.delete(k)}
  },
  fetch(url){requests.push(url);throw Error('No external HTTP calls allowed by QA unit tests')}
 };
 vm.createContext(ctx);
 const exposed=js.replace(/\}\)\(\);\s*$/, 'globalThis.__verdict={rpcDenied,storageVerdict,photoMeta,validateInputs,start};})();');
 assert.notEqual(exposed,js,'QA verdict injection point must exist');
 new vm.Script(exposed,{filename:'atokore-v50-auth-qa.html'}).runInContext(ctx);
 return {nodes,created,doc,state,requests,verdict:ctx.__verdict};
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

test('A/B/C errors are field-specific and do not lock the QA or call Auth',async()=>{
 const q=load(),key='atk_v50_qa_once_d59b5fa73f';
 const errors=['a','b','c'].map(r=>q.doc.getElementById('error-'+r));
 const passwords=['a','b','c'].map(r=>q.doc.getElementById('password-'+r));
 const emails=['a','b','c'].map(r=>q.doc.getElementById('email-'+r));
 assert(emails.every(e=>e.readOnly===true),'QA email inputs are fixed to the synthetic cohort');
 await q.verdict.start();
 assert.equal(q.nodes.start.disabled,false,'invalid inputs must leave button active');
 assert.equal(q.state.has(key),false,'invalid preflight cannot set the irreversible run marker');
 assert.equal(q.requests.length,0,'no Supabase Auth requests are allowed before preflight');
 assert.match(q.nodes.status.textContent,/通信はしていません/);
 for(let i=0;i<3;i++){
  assert.equal(errors[i].hidden,false);
  assert.match(errors[i].textContent,RegExp('合成アカウント '+['A','B','C'][i]));
  assert.match(errors[i].textContent,/12文字以上/);
  assert.equal(passwords[i].attributes['aria-invalid'],'true');
 }
 passwords.forEach((p,i)=>{p.value=['Correct-password-A','Correct-password-B','Correct-password-C'][i]});
 emails[1].value='wrong@example.invalid';
 await q.verdict.start();
 assert.equal(q.requests.length,0);
 assert.equal(q.state.has(key),false);
 assert.match(errors[1].textContent,/メール/);
 assert.equal(errors[0].hidden,true);
 assert.equal(errors[2].hidden,true);
 emails[1].value='atokore-qa-b-d59b5fa73f@example.invalid';
 const valid=q.verdict.validateInputs();
 assert.equal(valid.a,'Correct-password-A');
 assert.equal(valid.b,'Correct-password-B');
 assert.equal(valid.c,'Correct-password-C');
 assert.equal(errors[1].hidden,true,'corrected credentials clear the error');
 assert.equal(q.state.has(key),false,'read-only validation cannot set a run marker');
 await q.verdict.start(); // fake fetch throws at first Auth call; never reaches real Supabase
 assert.equal(q.requests.length,1,'one network attempt only AFTER all inputs are valid');
 assert.equal(q.state.has(key),true,'real Auth attempt consumes one-shot run marker');
 assert.equal(q.nodes.start.disabled,true);
});
test('only old pre-network validation errors are unlocked; real Auth progress stays locked',()=>{
 const key='atk_v50_qa_once_d59b5fa73f';
 const legacy=load(undefined,undefined,[[key,'検証処理 : FAIL (only this cohort is allowed)\nSynthetic-only IDs for controlled database cleanup:']]);
 assert.equal(legacy.nodes.start.disabled,false);
 assert.equal(legacy.state.has(key),false);
 const begun=load(undefined,undefined,[[key,'実Authログイン A : PASS\n検証処理 : FAIL (only this cohort is allowed)']]);
 assert.equal(begun.nodes.start.disabled,true);
 assert.equal(begun.state.has(key),true);
 const ambiguous=load(undefined,undefined,[[key,'QA開始済み']]);
 assert.equal(ambiguous.nodes.start.disabled,true,'ambiguous prior runs remain locked');
});
