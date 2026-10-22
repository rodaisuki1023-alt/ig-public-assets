/* Google sign-in through Supabase Auth PKCE. No Google client secret belongs in this file.
 * Kept behind the trial's explicit household config. Google only grants sign-in identity.
 * No stock data, photos, Drive contents or receipt text is sent to Google by this module.
 */
(function(root){
'use strict';
const KEY='atokoreHouseholdOAuthV1',TTL=15*60*1000;
function create(env){
 const now=env.now||(()=>Date.now()),base=env.url.replace(/\/+$/,'');
 const fail=message=>Object.assign(Error(message),{code:'auth'});
 const storage=()=>typeof env.storage==='function'?env.storage():env.storage;
 const b64=bytes=>{
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';let s='',bits=0,n=0;
  for(const b of bytes){n=(n<<8)|b;bits+=8;while(bits>=6){bits-=6;s+=alphabet[(n>>>bits)&63]}}
  if(bits)s+=alphabet[(n<<(6-bits))&63];return s;
 };
 const url=()=>new URL(env.location.href);
 const hasCallback=()=>url().searchParams.has('atokore_auth');
 async function start(){
  if(hasCallback())throw fail('ログイン処理が残っています。ページを再読み込みしてください');
  if(!env.crypto?.subtle||!env.crypto?.getRandomValues)throw fail('安全なログインを開始できません。Safariなどのブラウザで開いてください');
  const verifier=b64(env.crypto.getRandomValues(new Uint8Array(32)));
  const state=b64(env.crypto.getRandomValues(new Uint8Array(24)));
  const challenge=b64(new Uint8Array(await env.crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  const redirect=url();redirect.search='';redirect.hash='';redirect.searchParams.set('atokore_auth',state);
  const pending=JSON.stringify({verifier,state,at:now(),redirect:redirect.href,base});
  try{storage().setItem(KEY,pending);if(storage().getItem(KEY)!==pending)throw Error('storage')}catch(e){throw fail('ログインの準備を端末に保存できませんでした。保存設定を確認してください')}
  const target=new URL(base+'/auth/v1/authorize');
  for(const [k,v] of Object.entries({provider:'google',redirect_to:redirect.href,code_challenge:challenge,code_challenge_method:'s256',prompt:'select_account'}))target.searchParams.set(k,v);
  env.navigate(target.href);
 }
 let finishing=null;
 function finish(){
  if(finishing)return finishing;
  if(!hasCallback())return Promise.resolve(null);
  finishing=(async()=>{
   const current=url(),marker=current.searchParams.get('atokore_auth'),code=current.searchParams.get('code');
   const fragment=new URLSearchParams(current.hash.slice(1));
   const error=current.searchParams.get('error')||current.searchParams.get('error_code')||fragment.get('error')||fragment.get('error_code');
   const tokenFragment=fragment.has('access_token')||fragment.has('refresh_token');
   const authFragmentKeys=['code','error','error_code','error_description','access_token','refresh_token','token_type','expires_in','expires_at','provider_token','provider_refresh_token'];
   if(authFragmentKeys.some(k=>fragment.has(k))){for(const k of authFragmentKeys)fragment.delete(k);current.hash=fragment.toString()}
   for(const k of ['atokore_auth','code','error','error_code','error_description'])current.searchParams.delete(k);
   // Never leave the one-use auth code or provider errors in the address bar/history.
   env.history.replaceState(null,'',current.pathname+current.search+current.hash);
   let pending;
   try{pending=JSON.parse(storage().getItem(KEY)||'null')}catch(e){}
   if(!pending||pending.state!==marker||pending.base!==base)throw fail('ログインの確認ができません。もう一度ログインしてください');
   // Consume only this attempt; a stale callback must not erase another tab's newer attempt.
   try{storage().removeItem(KEY);if(storage().getItem(KEY)!==null)throw Error('storage')}catch(e){throw fail('端末の保存設定を確認して、もう一度ログインしてください')}
   const expected=new URL(pending.redirect);
   if(expected.origin!==current.origin||expected.pathname!==current.pathname||!Number.isFinite(pending.at)||now()-pending.at>TTL||now()<pending.at-60000||!/^[A-Za-z0-9_-]{43}$/.test(pending.verifier))throw fail('ログインの有効時間が過ぎました。もう一度ログインしてください');
   if(error||tokenFragment)throw fail('Googleログインを完了できませんでした。もう一度お試しください');
   if(!code||code.length>4096)throw fail('ログイン用のコードがありません。もう一度ログインしてください');
   let response;
   try{response=await env.fetch(base+'/auth/v1/token?grant_type=pkce',{method:'POST',headers:{'Content-Type':'application/json',apikey:env.key},body:JSON.stringify({auth_code:code,code_verifier:pending.verifier}),credentials:'omit',referrerPolicy:'no-referrer'})}catch(e){throw fail('通信できませんでした。もう一度ログインしてください')}
   if(!response.ok)throw fail('Googleログインの確認に失敗しました。もう一度ログインしてください');
   const session=await response.json();
   if(!session?.access_token||!session?.refresh_token||!session?.user?.id)throw fail('ログイン情報を確認できませんでした');
   return session;
  })();return finishing;
 }
 return Object.freeze({start,finish,hasCallback});
}
const api=Object.freeze({create});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreGoogleAuth=api;
})(typeof globalThis!=='undefined'?globalThis:this);
