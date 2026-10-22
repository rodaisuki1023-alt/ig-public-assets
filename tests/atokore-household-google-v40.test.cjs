const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto,createHash}=require('node:crypto');
const {create}=require('../atokore-live-v125/household-google-v40.js');
const KEY='atokoreHouseholdOAuthV1';
function fixture(){
 const data=new Map(),requests=[];let redirected=null,time=100000;
 const env={url:'https://trial.supabase.co',key:'sb_publishable_public',crypto:webcrypto,
  location:{href:'https://example.com/preview-baby-v19/'},
  storage:{setItem:(k,v)=>data.set(k,v),getItem:k=>data.get(k)??null,removeItem:k=>data.delete(k)},
  history:{replaceState:(_s,_t,url)=>{env.location.href=new URL(url,env.location.href).href}},
  now:()=>time,navigate:url=>{redirected=url},fetch:async(...args)=>{requests.push(args);return {ok:true,json:async()=>({access_token:'jwt',refresh_token:'refresh',user:{id:'a'}})}}};
 return {env,data,requests,auth:()=>create(env),get target(){return new URL(redirected)},advance:ms=>{time+=ms},callback(){const p=JSON.parse(data.get(KEY));env.location.href=p.redirect+'&code=one-use-code'}};
}
test('Google uses PKCE S256, same-path callback, public apikey and no bearer secret',async()=>{
 const f=fixture();await f.auth().start();
 const p=JSON.parse(f.data.get(KEY));
 assert.equal(f.target.searchParams.get('provider'),'google');
 assert.equal(f.target.searchParams.get('code_challenge_method'),'s256');
 assert.equal(f.target.searchParams.get('code_challenge'),createHash('sha256').update(p.verifier).digest('base64url'));
 assert.equal(new URL(p.redirect).pathname,'/preview-baby-v19/');
 f.callback();const a=f.auth();const [s,s2]=await Promise.all([a.finish(),a.finish()]);
 assert.equal(s.user.id,'a');assert.deepEqual(s,s2);assert.equal(f.requests.length,1);
 const [url,req]=f.requests[0];assert.match(url,/token\?grant_type=pkce$/);
 assert.equal(req.headers.apikey,'sb_publishable_public');assert.equal(req.headers.Authorization,undefined);
 assert.deepEqual(JSON.parse(req.body),{auth_code:'one-use-code',code_verifier:p.verifier});
 assert.equal(f.data.has(KEY),false);assert.equal(new URL(f.env.location.href).search,'');
 assert.equal(await f.auth().finish(),null,'reload cannot replay a consumed code');
});
test('storage failure stops navigation before OAuth starts',async()=>{
 const f=fixture();f.env.storage.setItem=()=>{throw Error('quota')};
 await assert.rejects(f.auth().start(),/保存できません/);assert.equal(f.requests.length,0);
 assert.throws(()=>f.target);
});
test('expired or wrong-path attempts cannot exchange codes and URL is cleaned',async()=>{
 for(const mode of ['expired','path','future']){
  const f=fixture();await f.auth().start();f.callback();
  if(mode==='expired')f.advance(16*60*1000);
  if(mode==='future')f.advance(-61000);
  if(mode==='path')f.env.location.href=f.env.location.href.replace('preview-baby-v19','production');
  await assert.rejects(f.auth().finish(),/有効時間/);assert.equal(f.requests.length,0);assert.equal(new URL(f.env.location.href).search,'');
 }
});
test('unmatched callback preserves the newer tab attempt, never exchanges or touches stock',async()=>{
 const f=fixture();await f.auth().start();const older=JSON.parse(f.data.get(KEY));
 await f.auth().start();const newer=f.data.get(KEY);
 f.env.location.href=older.redirect+'&code=old';
 await assert.rejects(f.auth().finish(),/確認ができません/);
 assert.equal(f.data.get(KEY),newer);assert.equal(f.requests.length,0);
});
test('cancel, missing code and network failure keep stock and reject without a session',async()=>{
 for(const mode of ['cancel','missing','network','http','bad_session']){
  const f=fixture();f.data.set('atokoreTrialV4','existing stock');await f.auth().start();f.callback();
  if(mode==='cancel')f.env.location.href=f.env.location.href.replace('code=one-use-code','error=access_denied');
  if(mode==='missing')f.env.location.href=f.env.location.href.replace('&code=one-use-code','');
  if(mode==='network')f.env.fetch=async()=>{throw Error('network')};
  if(mode==='http')f.env.fetch=async()=>({ok:false});
  if(mode==='bad_session')f.env.fetch=async()=>({ok:true,json:async()=>({})});
  await assert.rejects(f.auth().finish());assert.equal(f.data.get('atokoreTrialV4'),'existing stock');assert.equal(f.data.has(KEY),false);
 }
});
test('provider errors and unexpected implicit tokens in fragments are removed and never exchanged',async()=>{
 for(const hash of ['#error=access_denied&error_description=cancelled','#access_token=secret&refresh_token=secret&token_type=bearer&expires_in=3600']){
  const f=fixture();await f.auth().start();f.callback();f.env.location.href+=hash;
  await assert.rejects(f.auth().finish(),/完了できません/);
  assert.equal(new URL(f.env.location.href).hash,'');assert.equal(new URL(f.env.location.href).search,'');assert.equal(f.requests.length,0);
 }
});
