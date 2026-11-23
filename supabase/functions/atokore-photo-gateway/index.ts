/**
 * Trial-only prototype: DO NOT DEPLOY without approved SQL proposal, explicit
 * allowed Origins, secret-key review, old-photo migration and HTTP revocation QA.
 *
 * Browser -> POST Edge Function -> live user/Auth + membership RPC -> service
 * Storage in an RLS-denied private bucket. No Storage object URL is disclosed.
 *
 * Supabase server SDK 1.9.2: https://supabase.com/docs/guides/functions/auth
 * supabase/config.toml keeps verify_jwt=true; SDK auth:'user' is a second gate.
 */
import { withSupabase } from 'npm:@supabase/server@1.9.2'
import { createPhotoGatewayHandler } from '../_shared/photo-gateway-handler.mjs'

const BUCKET='atokore-private-photos-v2'
const MAX_REQUEST_BYTES=125000
const NO_STORE={
  'Cache-Control':'private, no-store, max-age=0',
  'Pragma':'no-cache',
  'X-Content-Type-Options':'nosniff',
  'Vary':'Origin'
}

function originHeaders(req){
  const origin=req.headers.get('origin')||''
  let allowed=['https://atokore-v50-owner-review-20261122.vercel.app']
  try{
    allowed=[...allowed,...(Deno.env.get('ATOKORE_ALLOWED_ORIGINS')||'').split(',').map(s=>s.trim())]
      .filter(s=>s.startsWith('https://')&&/^https:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(s))
  }catch{return null}
  if(!allowed.includes(origin))return null
  return {
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'authorization, apikey, content-type',
    'Access-Control-Max-Age':'0'
  }
}
function response(status,body,origin,contentType='application/json'){
 const headers={...NO_STORE,...origin,'Content-Type':contentType}
 return new Response(body,{status,headers})
}
function failed(status,reason,origin){
 return response(status,JSON.stringify({error:reason}),origin)
}
async function safeJson(req){
  if(!req.body)throw Error('missing_body')
  const reader=req.body.getReader()
  const buffers=[]
  let total=0
  try{
    for(;;){
      const {done,value}=await reader.read()
      if(done)break
      total+=value.byteLength
      if(total>MAX_REQUEST_BYTES)throw Error('body_limit')
      buffers.push(value)
    }
  }finally{reader.releaseLock()}
  const bytes=new Uint8Array(total)
  let offset=0
  for(const buf of buffers){bytes.set(buf,offset);offset+=buf.byteLength}
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid_request')
  return data
}

// The server wrapper checks the Auth JWT, then these callbacks consult Auth and
// the database again for EACH photo request. A JWT claim is never accepted as
// evidence of current household membership.
const secureHandler=withSupabase({auth:'user'},async (req,ctx)=>{
 const cors=originHeaders(req)
 if(!cors)return failed(403,'origin',{})
 if(req.method!=='POST')return failed(405,'method',cors)
 const bearer=/^Bearer (.+)$/.exec(req.headers.get('authorization')||'')
 if(!bearer)return failed(401,'auth',cors)
 let input
 try{input=await safeJson(req)}catch{return failed(400,'invalid_request',cors)}
 if(typeof input.operation!=='string')return failed(400,'operation',cors)

 const handler=createPhotoGatewayHandler({
  verifySession:async(token)=>{
    const {data,error}=await ctx.supabase.auth.getUser(token)
    if(error||!data?.user)return null
    if(ctx.userClaims?.sub && ctx.userClaims.sub!==data.user.id)return null
    return {id:data.user.id}
  },
  checkCurrentAccess:async({path,operation})=>{
    // Public boolean RPC binds auth.uid() to the JWT in ctx.supabase.
    // It checks active membership, live item and the exact current photoPath.
    const {data,error}=await ctx.supabase.rpc('hh_photo_access',{
      p_path:path,p_operation:operation
    })
    if(error)throw Error('authorization_unavailable')
    return data===true
  },
  readObject:async(path)=>{
    const {data,error}=await ctx.supabaseAdmin.storage.from(BUCKET).download(path)
    if(error||!data)throw Error('storage_unavailable')
    return new Uint8Array(await data.arrayBuffer())
  },
  writeObject:async(path,bytes)=>{
    const {error}=await ctx.supabaseAdmin.storage.from(BUCKET).upload(path,bytes,{
      upsert:false,contentType:'image/jpeg',cacheControl:'0'
    })
    if(error)throw Error('storage_unavailable')
  },
  removeObject:async(path)=>{
    const {error}=await ctx.supabaseAdmin.storage.from(BUCKET).remove([path])
    if(error)throw Error('storage_unavailable')
  },
  newFileId:()=>crypto.randomUUID()
 })
 const result=await handler({
  operation:input.operation,
  path:input.path,
  householdId:input.householdId,
  recordId:input.recordId,
  base64:input.base64,
  accessToken:bearer[1]
 })
 if(result.status===200 && result.bytes){
   return response(200,result.bytes,cors,'image/jpeg')
 }
 if(result.status===200){
   return response(200,JSON.stringify({
     ...(result.path?{path:result.path}:{}),
     ...(result.deleted?{deleted:true}:{})
   }),cors)
 }
 return failed(result.status,result.error||'denied',cors)
})

export default {
 fetch(req){
   // Preflight is answered without entering the Auth handler; it never grants
   // resource access. Every non-preflight request is verified by withSupabase.
   const cors=originHeaders(req)
   if(!cors)return failed(403,'origin',{})
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...NO_STORE,...cors}})
   return secureHandler(req)
 }
}
