/**
 * Isolated business logic for a future photo-only Supabase Edge Function.
 * NOT DEPLOYED. NO direct Storage URL or signed URL is ever returned.
 * This module has no access to runtime secrets; callers inject privileged
 * Storage operations and per-request Auth/DB checks from a trusted server.
 */
import { authorizePhotoOperation, parsePhotoPath, validJpegBytes, PHOTO_MAX_BYTES } from './photo-gateway-policy.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RECORD=/^[A-Za-z0-9_-]{8,64}$/;
const MAX_B64=Math.ceil(PHOTO_MAX_BYTES/3)*4;
const deny=(status,reason)=>Object.freeze({status,error:reason});
const validId=s=>typeof s==='string'&&UUID.test(s);

function decodeJpeg(b64){
 if(typeof b64!=='string'||b64.length<8||b64.length>MAX_B64||b64.length%4!==0||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(b64))return null;
 try{
  const raw=atob(b64);
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  return validJpegBytes(bytes)?bytes:null;
 }catch{return null}
}

export function createPhotoGatewayHandler({verifySession,checkCurrentAccess,readObject,writeObject,removeObject,newFileId}={}){
 if([verifySession,checkCurrentAccess,readObject,writeObject,removeObject,newFileId].some(x=>typeof x!=='function'))
   throw new TypeError('trusted auth, current membership, storage and UUID adapters required');
 const authorize=async(operation,path,accessToken)=>authorizePhotoOperation({
   operation,path,accessToken,verifySession,checkCurrentAccess
 });
 return async function handle({operation,path,householdId,recordId,base64,accessToken}={}){
   if(!['read','write','delete'].includes(operation))return deny(400,'operation');
   if(typeof accessToken!=='string'||!accessToken)return deny(401,'auth');
   let objectPath=path,bytes=null;
   if(operation==='write'){
     if(!validId(householdId)||typeof recordId!=='string'||!RECORD.test(recordId))
       return deny(400,'path');
     bytes=decodeJpeg(base64);
     if(!bytes)return deny(400,'jpeg_invalid');
     const fileId=newFileId();
     if(!validId(fileId))return deny(503,'unavailable');
     objectPath=householdId+'/'+recordId+'/'+fileId+'.jpg';
   }else if(!parsePhotoPath(objectPath))return deny(400,'path');

   const before=await authorize(operation,objectPath,accessToken);
   if(!before.allowed)return deny(before.reason==='unavailable'?503:403,'denied');

   if(operation==='read'){
     let photo;
     try{photo=await readObject(objectPath)}catch{return deny(503,'unavailable')}
     if(!validJpegBytes(photo))return deny(502,'invalid_photo');
     const after=await authorize('read',objectPath,accessToken);
     if(!after.allowed)return deny(after.reason==='unavailable'?503:403,'denied');
     return Object.freeze({status:200,bytes:photo});
   }

   if(operation==='write'){
     try{await writeObject(objectPath,bytes)}catch{return deny(503,'unavailable')}
     const after=await authorize('write',objectPath,accessToken);
     if(!after.allowed){
       // No orphan image should be retained after losing membership.
       try{await removeObject(objectPath)}catch{return deny(503,'cleanup_unconfirmed')}
       return deny(after.reason==='unavailable'?503:403,'denied');
     }
     return Object.freeze({status:200,path:objectPath});
   }

   // Re-check membership again immediately BEFORE a destructive call.
   const after=await authorize('delete',objectPath,accessToken);
   if(!after.allowed)return deny(after.reason==='unavailable'?503:403,'denied');
   try{await removeObject(objectPath)}catch{return deny(503,'unavailable')}
   return Object.freeze({status:200,deleted:true});
 };
}
