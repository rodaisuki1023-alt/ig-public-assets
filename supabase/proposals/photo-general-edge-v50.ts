// DRAFT ONLY: located in proposals, not an active Edge Function.
// Deployment, DB proposals, allowlist, lockfile and actual Storage QA require separate approval.
import { withSupabase } from 'npm:@supabase/server@1.9.2'
import jpeg from 'npm:jpeg-js@0.4.4'
import { createGeneralPhotoHandler,makeJpegNormalizer } from './photo-general-v50.mjs'
const BUCKET='atokore-private-photos-v2'
const MAX=125000
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Vary':'Origin'}
function cors(req:Request){
 const origin=req.headers.get('origin')||''
 const allowed=(Deno.env.get('ATOKORE_GENERAL_PHOTO_ORIGINS')||'').split(',').map(s=>s.trim()).filter(s=>/^https:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(s))
 return allowed.includes(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Max-Age':'0'}:null
}
function reply(status:number,data:unknown,c:Record<string,string>={}){
 const bytes=data instanceof Uint8Array
 return new Response(status===204?null:bytes?data:JSON.stringify(data),{status,headers:{...headers,...c,'Content-Type':bytes?'image/jpeg':'application/json'}})
}
async function body(req:Request){
 if(!req.body||!/^application\/json(?:;|$)/i.test(req.headers.get('content-type')||''))throw Error('invalid')
 const reader=req.body.getReader(),parts:Uint8Array[]=[]
 let total=0,timer:number|undefined
 try{
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),4000)})
  for(;;){
   const x=await Promise.race([reader.read(),timeout])
   if(x.done)break
   total+=x.value.byteLength;if(total>MAX)throw Error('limit')
   parts.push(x.value)
  }
  const data=new Uint8Array(total);let off=0
  for(const part of parts){data.set(part,off);off+=part.byteLength}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data))
 }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock()}
}
const secure=withSupabase({auth:'user'},async(req,ctx)=>{
 const c=cors(req);if(!c)return reply(403,{error:'origin'})
 if(req.method!=='POST')return reply(405,{error:'method'},c)
 if(Deno.env.get('ATOKORE_GENERAL_PHOTO_ENABLED')!=='true')return reply(503,{error:'disabled'},c)
 const token=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(req.headers.get('authorization')||'')?.[1]
 if(!token)return reply(401,{error:'auth'},c)
 let input;try{input=await body(req)}catch{return reply(400,{error:'invalid_request'},c)}
 const store=ctx.supabaseAdmin.storage.from(BUCKET)
 const handle=createGeneralPhotoHandler({
  verify:async(t:string)=>{
   const {data,error}=await ctx.supabase.auth.getUser(t)
   if(error||!data?.user||ctx.jwtClaims?.sub!==data.user.id)return null
   return {uid:data.user.id,session:ctx.jwtClaims.session_id}
  },
  admit:async(user:{uid:string,session:string},household:string,operation:string)=>{
   const {data,error}=await ctx.supabaseAdmin.rpc('hh_photo_budget_service_v50',{p_uid:user.uid,p_session:user.session,p_household:household,p_operation:operation})
   if(error)throw Error('budget unavailable')
   return data===true
  },
  db:async(user:{uid:string,session:string},action:string,fields:Record<string,unknown>)=>{
   const {data,error}=await ctx.supabaseAdmin.rpc('hh_photo_service_v50',{p_uid:user.uid,p_session:user.session,p_action:action,...fields})
   if(error)throw Object.assign(Error('photo service'),{code:error.code})
   return data
  },
  storage:{
   download:async(path:string)=>{
    const {data,error}=await store.download(path)
    if(error||!data||data.size>81920||data.size===0)throw Error('storage')
    return new Uint8Array(await data.arrayBuffer())
   },
   upload:async(path:string,bytes:Uint8Array)=>{
    const {error}=await store.upload(path,bytes,{upsert:false,contentType:'image/jpeg',cacheControl:'0'})
    if(error)throw Error('storage')
   }
  },
  normalize:makeJpegNormalizer(jpeg)
 })
 const result=await handle(input,token)
 const {status,bytes,...rest}=result
 return reply(status,bytes||rest,c)
})
export default {fetch(req:Request){
 const c=cors(req);if(!c)return reply(403,{error:'origin'})
 if(req.method==='OPTIONS')return reply(204,null,c)
 return Promise.resolve(secure(req)).catch(()=>reply(503,{error:'unavailable'},c))
}}
