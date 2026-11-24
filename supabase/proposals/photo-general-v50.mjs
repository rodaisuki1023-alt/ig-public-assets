// DRAFT, not used by the deployed synthetic gateway. No credentials here.
const MAX=81920, UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RECORD=/^[A-Za-z0-9_-]{8,64}$/;
const id=v=>typeof v==='string'&&v.length===36&&UUID.test(v);
const record=v=>typeof v==='string'&&!/\s/.test(v)&&RECORD.test(v);
const bad=(status,error)=>({status,error});
const seq=v=>Number.isSafeInteger(v)&&v>=0;
export function parsePath(v){
 if(typeof v!=='string'||v.length>180||/\s/.test(v))return null;
 const p=v.split('/');if(p.length!==3||!id(p[0])||!record(p[1])||!p[2].endsWith('.jpg')||!id(p[2].slice(0,-4)))return null;
 return {household:p[0],record:p[1],file:p[2].slice(0,-4)};
}
function scopedPath(v,h,r,f){const p=parsePath(v);return p&&p.household===h&&p.record===r&&(!f||p.file===f)}
export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')}
function bounded(bytes){return bytes instanceof Uint8Array&&bytes.length>=4&&bytes.length<=MAX&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217}
function base64(s){
 if(typeof s!=='string'||s.length>Math.ceil(MAX/3)*4||s.length%4||!s.length||/\s/.test(s)||!/^[A-Za-z0-9+/]+={0,2}$/.test(s))return null;
 try{const b=Uint8Array.from(atob(s),c=>c.charCodeAt(0));return bounded(b)?b:null}catch{return null}
}
// Restrict decoder to a baseline JPEG, one scan, <=256x256, 8-bit/1 or 3
// components. No progressive image bomb, extra frames or trailing payload.
export function jpegFrame(bytes){
 if(!bounded(bytes))return null;
 let i=2,frame=null,scan=false,segments=0;
 while(i<bytes.length-2&&++segments<=64){
  if(bytes[i++]!==255)return null;
  while(bytes[i]===255)i++;
  const marker=bytes[i++];
  if(i+2>bytes.length)return null;
  const len=bytes[i]*256+bytes[i+1],end=i+len;
  if(len<2||end>bytes.length-2)return null;
  if(marker===192){
   if(frame||len<8||bytes[i+2]!==8)return null;
   const height=bytes[i+3]*256+bytes[i+4],width=bytes[i+5]*256+bytes[i+6],n=bytes[i+7];
   if(!height||!width||height>256||width>256||![1,3].includes(n)||len!==8+3*n)return null;
   frame={width,height,components:n};
  }else if(marker===218){
   if(!frame||scan||bytes[i+2]!==frame.components||len!==6+2*frame.components)return null;
   scan=true;i=end;
   // Entropy bytes permit stuffed FF00 and restart markers only; EOI must
   // be the last marker, not just the last two bytes of a polyglot.
   while(i<bytes.length){
    if(bytes[i++]!==255)continue;
    while(bytes[i]===255)i++;
    const m=bytes[i++];
    if(m===0||(m>=208&&m<=215))continue;
    return m===217&&i===bytes.length?frame:null;
   }
   return null;
  }else if(!([196,219,221,254].includes(marker)||(marker>=224&&marker<=239)))return null;
  i=end;
 }
 return null;
}
export function makeJpegNormalizer(codec){
 if(typeof codec?.decode!=='function'||typeof codec?.encode!=='function')throw Error('jpeg codec required');
 return bytes=>{
  const frame=jpegFrame(bytes);if(!frame)return null;
  try{
   const decoded=codec.decode(bytes,{useTArray:true,formatAsRGBA:true,tolerantDecoding:false,maxResolutionInMP:0.066,maxMemoryUsageInMB:16});
   if(decoded.width!==frame.width||decoded.height!==frame.height||decoded.data.length!==frame.width*frame.height*4)return null;
   // Only pixel data is passed to encoder: no EXIF/comment/ICC metadata.
   const clean=Uint8Array.from(codec.encode({width:frame.width,height:frame.height,data:decoded.data},78).data);
   const check=jpegFrame(clean);
   return check&&check.width===frame.width&&check.height===frame.height?clean:null;
  }catch{return null}
 }
}
const mapError=e=>e?.code==='42501'?bad(403,'denied'):['23505','40001','55000'].includes(e?.code)?bad(409,'conflict'):bad(503,'unavailable');
export function createGeneralPhotoHandler({verify,db,storage,normalize}){
 if([verify,db,normalize,storage?.download,storage?.upload].some(f=>typeof f!=='function'))throw Error('missing trusted adapter');
 return async function handle(input,token){
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof token!=='string'||!token)return bad(401,'auth');
  const op=input.operation;
  if(!['read','write','delete'].includes(op))return bad(400,'operation');
  try{
   const user=await verify(token);
   if(!id(user?.uid)||!id(user?.session))return bad(401,'auth');
   const run=(action,fields)=>db(user,action,fields);
   if(op==='read'||op==='delete'){
    const p=parsePath(input.path);if(!p)return bad(400,'path');
    const f={p_h:p.household,p_r:p.record,p_file:p.file};
    if(op==='delete'){
     if(!seq(input.expectedSeq))return bad(400,'revision');
     const x=await run('detach',{...f,p_seq:input.expectedSeq});
     return seq(x?.seq)?{status:200,deleted:true,seq:x.seq}:bad(503,'unavailable');
    }
    const a=await run('read',f);
    if(a?.path!==input.path||!Number.isInteger(a.bytes)||a.bytes<1||a.bytes>MAX||typeof a.sha!=='string'||a.sha.length!==64)return bad(403,'denied');
    const bytes=await storage.download(a.path);
    if(!bounded(bytes)||bytes.length!==a.bytes||await sha256(bytes)!==a.sha||!jpegFrame(bytes))return bad(502,'invalid_photo');
    const b=await run('read',f);
    if(b?.path!==a.path||b.sha!==a.sha||b.bytes!==a.bytes)return bad(403,'denied');
    return {status:200,bytes};
   }
   const h=input.householdId,r=input.recordId,o=input.operationId,expected=input.expectedPath;
   if(!id(h)||!record(r)||!id(o)||!seq(input.expectedSeq)||(expected!==null&&!scopedPath(expected,h,r)))return bad(400,'request');
   const raw=base64(input.base64);if(!raw)return bad(400,'jpeg_invalid');
   const bytes=normalize(raw);if(!bounded(bytes)||!jpegFrame(bytes))return bad(400,'jpeg_invalid');
   const sha=await sha256(bytes);
   const res=await run('reserve',{p_h:h,p_r:r,p_operation:o,p_expected:expected,p_seq:input.expectedSeq,p_sha:sha});
   if(!id(res?.file_id)||!scopedPath(res.path,h,r,res.file_id)||res.sha!==sha)return bad(503,'unavailable');
   const f={p_h:h,p_r:r,p_file:res.file_id,p_sha:sha};
   if(res.state==='attached'&&res.current===true&&seq(res.seq))return {status:200,path:res.path,seq:res.seq,reused:true};
   if(res.state==='reserved'){
    const b=await run('begin',f);
    if(b?.path!==res.path)return bad(503,'unavailable');
    // Exactly one write, no upsert. If this throws after committing remotely,
    // return pending; a retry must recover via positive byte evidence.
    try{await storage.upload(res.path,bytes)}catch{return bad(503,'upload_pending')}
   }else if(!['uploading','uploaded'].includes(res.state))return bad(409,'conflict');
   // Never retry upload at an uploading path. Absence/mismatch remains charged.
   let stored;
   try{stored=await storage.download(res.path)}catch{return bad(503,'upload_pending')}
   if(!bounded(stored)||stored.length!==bytes.length||await sha256(stored)!==sha)return bad(503,'upload_pending');
   const confirmed=await run('finish',{...f,p_bytes:bytes.length});
   if(confirmed?.ok!==true)return bad(503,'upload_pending');
   const attached=await run('attach',f);
   if(attached?.path!==res.path||!seq(attached.seq))return bad(503,'unavailable');
   return {status:200,path:attached.path,seq:attached.seq,reused:attached.reused===true};
  }catch(e){return mapError(e)}
 }
}
// Trusted cleanup worker ONLY. No user-accessible route. Safe even after a
// retry: claim must identify an unreferenced retired path, then use Storage API.
export async function purgeRetired({worker,storage},file){
 if(!id(file))throw Error('invalid file');
 const p=await worker('claim_purge',file);
 const path=parsePath(p?.path);if(!path||path.file!==file)throw Error('invalid purge path');
 await storage.remove(p.path); // throws on ambiguous response
 const done=await worker('finish_purge',file,{p_confirmed:true});
 return done?.ok===true; // DB additionally checks metadata absence
}

// Run only from a trusted worker, not a request originating from the browser.
// A timeout/absent object after begin remains unresolved; never "guess clean".
export async function reconcileExpired({worker,storage},file){
 if(!id(file))throw Error('invalid file');
 const x=await worker('inspect_expired',file);
 if(x?.ok!==true)return {state:'held'};
 const p=parsePath(x.path);if(!p||p.file!==file)throw Error('invalid reconciliation path');
 if(x.state==='uploading'){
  let bytes;try{bytes=await storage.download(x.path)}catch{return {state:'held'};}
  if(!bounded(bytes)||!jpegFrame(bytes)||await sha256(bytes)!==x.sha)return {state:'held'};
  const done=await worker('settled_upload',file,{p_sha:x.sha,p_confirmed:true});
  if(done?.ok!==true)return {state:'held'};
 }else if(x.state==='reserved'||x.state==='uploaded'){
  if((await worker('retire_expired',file))?.ok!==true)return {state:'held'};
 }else if(x.state!=='retired'&&x.state!=='purging')return {state:'held'};
 try{return {state:await purgeRetired({worker,storage},file)?'purged':'held'}}
 catch{return {state:'held'}}
}
