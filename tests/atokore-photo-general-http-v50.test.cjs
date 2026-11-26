// End-to-end localhost HTTP using real proposal SQL in PGlite, actual JPEG
// codec and an in-memory fake Storage API. No remote project, no real account.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),jpeg=require('jpeg-js');
const {createDb,call}=require('./household/pg.cjs');
const BUCKET='atokore-private-photos-v2',R='photo_item_http';
test('general photo HTTP: same-object revocation, retry, replacement, detach and tombstone purge',async()=>{
 const m=await import('../supabase/proposals/photo-general-v50.mjs');
 const db=await createDb(),A=randomUUID(),B=randomUUID(),C=randomUUID(),SA=randomUUID(),SB=randomUUID(),SC=randomUUID();
 let server;
 try{
  await db.exec('CREATE TABLE auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz)');
  for(const [sid,uid] of [[SA,A],[SB,B],[SC,C]])await db.query('INSERT INTO auth.sessions VALUES($1,$2,NULL)',[sid,uid]);
  for(const name of ['atokore-photo-reservation-v50.sql','atokore-photo-lifecycle-v50.sql','atokore-photo-service-v50.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/proposals',name),'utf8'));
  await db.query('INSERT INTO storage.buckets(id,name,public) VALUES($1,$1,false) ON CONFLICT(id) DO NOTHING',[BUCKET]);
  const h=(await call(db,A,'hh_create',{p_name:'HTTP-A',p_display_name:'A'})).household.id;
  const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
  await call(db,C,'hh_create',{p_name:'HTTP-C',p_display_name:'C'});
  const push=async(uid,fields)=>call(db,uid,'hh_push',{p_device:'qa-http',p_ops:[{op_id:randomUUID(),kind:'item',id:R,ts:Date.now(),...fields}]});
  assert.equal((await push(A,{type:'create',qty:1,fields:{name:'合成商品',unit:'個'}})).results[0].status,'applied');
  const getRow=async()=> (await db.query("SELECT seq,fields->>'photoPath' photo,deleted FROM atokore_private.records WHERE household_id=$1 AND kind='item' AND id=$2",[h,R])).rows[0];
  const identity={A:{uid:A,session:SA},B:{uid:B,session:SB},C:{uid:C,session:SC}};
  async function sqlService(user,action,f){
   const args={p_uid:user.uid,p_session:user.session,p_action:action,...f};
   return db.transaction(async tx=>{
    await tx.exec('SET LOCAL ROLE service_role');
    return (await tx.query('SELECT public.hh_photo_service_v50('+Object.keys(args).map((k,i)=>k+'=>$'+(i+1)).join(',')+') r',Object.values(args))).rows[0].r;
   });
  }
  const worker=async(action,file,f={})=>db.transaction(async tx=>{
   await tx.exec('SET LOCAL ROLE service_role');
   const args={p_file:file,p_action:action,...f};
   return (await tx.query('SELECT public.hh_photo_cleanup_service_v50('+Object.keys(args).map((k,i)=>k+'=>$'+(i+1)).join(',')+') r',Object.values(args))).rows[0].r;
  });
  const objects=new Map();let uploads=0,loss=true;
  const storage={
   upload:async(p,b)=>{assert.equal(objects.has(p),false);uploads++;objects.set(p,b);await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',[BUCKET,p]);if(loss){loss=false;throw Error('response lost')}},
   download:async(p)=>{if(!objects.has(p))throw Error('absent');return objects.get(p)},
   remove:async(p)=>{objects.delete(p);await db.query('DELETE FROM storage.objects WHERE bucket_id=$1 AND name=$2',[BUCKET,p])} // local mock only
  };
  const handler=m.createGeneralPhotoHandler({verify:async t=>Object.hasOwn(identity,t)?identity[t]:null,db:sqlService,storage,normalize:m.makeJpegNormalizer(jpeg)});
  server=http.createServer(async(req,res)=>{
   const headers={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'};
   try{
    if(req.url!=='/functions/v1/general-photo'||req.method!=='POST'){res.writeHead(403,headers);res.end();return}
    let total=0,parts=[];for await(const buf of req){total+=buf.length;if(total>125000)throw Error('limit');parts.push(buf)}
    const result=await handler(JSON.parse(Buffer.concat(parts).toString()),(req.headers.authorization||'').replace(/^Bearer /,''));
    const {status,bytes,...rest}=result;
    res.writeHead(status,{...headers,'Content-Type':bytes?'image/jpeg':'application/json'});res.end(bytes||JSON.stringify(rest));
   }catch{res.writeHead(400,headers);res.end()}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const base='http://127.0.0.1:'+server.address().port;
  const request=(token,input)=>fetch(base+'/functions/v1/general-photo',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(input),cache:'no-store'});
  const base64=Buffer.from(jpeg.encode({width:8,height:8,data:Buffer.alloc(8*8*4,180)},78).data).toString('base64');
  const makeWrite=async(expectedPath=null)=>({operation:'write',householdId:h,recordId:R,operationId:randomUUID(),expectedPath,expectedSeq:Number((await getRow()).seq),base64});
  const first=await makeWrite();
  assert.equal((await request('A',first)).status,503);
  assert.equal(uploads,1);
  const uploaded=await (await request('A',first)).json();assert.ok(uploaded.path);
  assert.equal(uploads,1);
  assert.equal((await (await request('A',first)).json()).reused,true);
  assert.equal(uploads,1);
  const read={operation:'read',path:uploaded.path},ra=await request('A',read),rb=await request('B',read);
  assert.equal(ra.status,200);assert.equal(rb.status,200);
  assert.match(ra.headers.get('cache-control'),/no-store/);
  assert.deepEqual(Buffer.from(await ra.arrayBuffer()),Buffer.from(await rb.arrayBuffer()));
  assert.equal((await request('C',read)).status,403);assert.equal((await request('invalid',read)).status,401);
  assert.equal((await fetch(base+'/storage/v1/object/authenticated/'+BUCKET+'/'+uploaded.path,{headers:{authorization:'Bearer B'}})).status,403);
  await call(db,A,'hh_remove_member',{p_user:B});
  assert.equal((await request('B',read)).status,403);
  assert.equal((await request('A',read)).status,200);
  const next=await makeWrite(uploaded.path),rp=await request('A',next);assert.equal(rp.status,200);
  const second=await rp.json();assert.notEqual(second.path,uploaded.path);
  assert.equal((await request('A',read)).status,403);
  assert.equal(await m.purgeRetired({worker,storage},m.parsePath(uploaded.path).file),true);
  // Stale detach fails without changing the currently attached object.
  assert.equal((await request('A',{operation:'delete',path:second.path,expectedSeq:first.expectedSeq})).status,409);
  const actual=Number((await getRow()).seq);
  assert.equal((await request('A',{operation:'delete',path:second.path,expectedSeq:actual})).status,200);
  assert.equal((await getRow()).photo,null);
  assert.equal(await m.purgeRetired({worker,storage},m.parsePath(second.path).file),true);
  // Ordinary inventory delete retires the managed photo atomically.
  const third=await (await request('A',await makeWrite())).json();assert.ok(third.path);
  assert.equal((await push(A,{type:'delete'})).results[0].status,'applied');
  assert.equal((await getRow()).deleted,true);assert.equal((await getRow()).photo,null);
  assert.equal((await request('A',{operation:'read',path:third.path})).status,403);
  assert.equal(await m.purgeRetired({worker,storage},m.parsePath(third.path).file),true);
  assert.equal(objects.size,0);
 }finally{
  if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve))}
  await db.close();
 }
});
