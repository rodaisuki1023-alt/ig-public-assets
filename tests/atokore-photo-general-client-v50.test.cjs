const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.resolve(__dirname,'../atokore-live-v125');
const core=require('../atokore-live-v125/household-core-v37.js');
const H='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',F='44444444-4444-4444-8444-444444444444',O='55555555-5555-4555-8555-555555555555',R='photo_item_0',P=H+'/'+R+'/'+F+'.jpg';
const state={items:[{id:1,name:'合成商品',unit:'個',qty:1,photoPath:P}],buys:[],routines:[]};
test('managed inventory ops cannot inject photoPath on create, set or complete_buy',()=>{
 const created=core.diff({items:[],buys:[],routines:[]},state,{}, {managedPhotos:true});
 assert.equal(created.ops.length,1);assert.equal('photoPath' in created.ops[0].fields,false);
 const altered=JSON.parse(JSON.stringify(state));altered.items[0].photoPath='foreign.jpg';altered.items[0].qty=2;
 const changed=core.diff(state,altered,{'item:1':R},{managedPhotos:true});
 assert.equal(changed.ops.length,1);assert.equal(changed.ops[0].type,'add');
 const p=JSON.parse(JSON.stringify(state));p.items=[];p.buys=[{id:2,name:'合成商品',unit:'個',qty:1}];
 const complete=core.diff(p,state,{'buy:2':'buy_000000'},{managedPhotos:true});
 assert.equal(complete.ops.length,1);assert.equal(complete.ops[0].type,'complete_buy');assert.equal('photoPath' in complete.ops[0].item_fields,false);
});
test('general transfer retries retain original revision and operation id; no client photoPath write',async()=>{
 const source=fs.readFileSync(path.join(dir,'household-sync-v37.js'),'utf8');
 const part=source.slice(source.indexOf('function photoUuid('),source.indexOf('\nasync function fetchPhoto('));
 const scope={household:H,user:U,sid:R},ctx={
  cfg:{anonKey:'synthetic'},base:'https://synthetic.invalid',session:{access_token:'token',expires_at:9999999999},
  status:{state:'synced'},photoGeneralEnabled:()=>true,photoScope:()=>scope,
  sameScope:(a,b)=>a&&b&&a.household===b.household&&a.user===b.user&&a.sid===b.sid,
  validPhotoPath:(p,s)=>p===P&&s.sid===R,Uint8Array,Date,setTimeout,clearTimeout,
  root:{crypto:{subtle:require('node:crypto').webcrypto.subtle,randomUUID:()=>O},AbortController,btoa:s=>Buffer.from(s,'binary').toString('base64')},
  refreshSession:()=>{throw Error('unexpected refresh')},syncing:null,syncNow:async()=>{},
 };
 let row={seq:7,fields:{}};let requests=[];
 ctx.engine={meta:()=>({base:{['item:'+R]:row}}),status:()=>({pending:0})};
 ctx.root.fetch=async(url,opts)=>{requests.push({url,opts,body:JSON.parse(opts.body)});return {ok:true,json:async()=>({path:P,seq:8})}};
 vm.runInNewContext(part+'\nglobalThis.plan=photoTransferPlan;globalThis.share=shareGeneralPhoto;',ctx);
 const blob={type:'image/jpeg',size:4,arrayBuffer:async()=>Uint8Array.from([255,216,255,217]).buffer};
 const plan=await ctx.plan(1,blob);assert.equal(plan.operationId,O);assert.equal(plan.expectedSeq,7);assert.equal(plan.expectedPath,null);
 row={seq:8,fields:{photoPath:P}};const retry=await ctx.plan(1,blob,JSON.parse(JSON.stringify(plan)));
 assert.equal(retry.expectedSeq,7);assert.equal(retry.operationId,O);assert.equal(retry.expectedPath,null);
 const result=await ctx.share(1,blob,retry);assert.equal(result.shared,true);
 assert.equal(requests.length,1);assert.equal(requests[0].body.operationId,O);assert.equal(requests[0].body.expectedSeq,7);
 assert.equal(requests[0].opts.cache,'no-store');assert.equal(requests[0].url,'https://synthetic.invalid/functions/v1/atokore-photo-general-v50');
 const other={...blob,arrayBuffer:async()=>Uint8Array.from([255,216,0,217]).buffer};
 await assert.rejects(ctx.plan(1,other,retry),/前回/);
 assert.equal(requests.length,1);
});
test('general protocol is disabled and the journal is persisted before sharePhoto',()=>{
 const config=fs.readFileSync(path.join(dir,'household-config-v37.js'),'utf8');
 assert.match(config,/photoGatewayEnabled:\s*false/);
 const p=fs.readFileSync(path.join(dir,'product-photos-v30.js'),'utf8'),a=p.indexOf('async function sendOne'),b=p.indexOf('function needsSending',a),s=p.slice(a,b);
 assert.ok(s.indexOf('store.put({...latest,boundScope:bound,transfer},k)')<s.indexOf('await hh.sharePhoto(item.id,blob,transfer,resume)'));
 assert.ok(s.indexOf('await hh.sharePhoto(item.id,blob,transfer,resume)')>0,'single send call');assert.match(s,/const resume=transfer\?null:/);
 assert.match(s,/if\(!persisted\)return false/);assert.match(s,/latest\.transfer\?\.operationId===transfer\.operationId/);
});

test('managed pending photos never cross household/user scope',()=>{
 const api=require('../atokore-live-v125/product-photos-v30.js');
 const a='household-a:user-a',b='household-b:user-a',c='household-a:user-b';
 assert.equal(api.canSendManagedPhoto({bytes:new Uint8Array(4)},a),true);
 assert.equal(api.canSendManagedPhoto({pending:true},a),false);
 assert.equal(api.canSendManagedPhoto({removed:true,pending:true},a),false);
 const pending={pending:true,boundScope:a};
 assert.equal(api.canSendManagedPhoto(pending,a),true);
 assert.equal(api.canSendManagedPhoto(pending,b),false);
 assert.equal(api.canSendManagedPhoto(pending,c),false);
});

test('photo queue rescans a local edit arriving during a transfer without sync-event spinning',async()=>{
 const {createPhotoQueue}=require('../atokore-live-v125/product-photos-v30.js');
 let scans=0,release,allowed=true;
 const first=new Promise(resolve=>{release=resolve});
 const run=createPhotoQueue(async()=>{if(++scans===1)await first},()=>allowed);
 const task=run();await Promise.resolve();assert.equal(scans,1);
 run();run(true);run();release();await task;
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(scans,2);
 allowed=false;assert.equal(run(true),null);allowed=true;await run();
 assert.equal(scans,3);
});

test('photo sync waits for an earlier flight then starts a new observation',async()=>{
 const source=fs.readFileSync(path.join(dir,'household-sync-v37.js'),'utf8');
 const part=source.slice(source.indexOf('async function syncPhotoFresh('),source.indexOf('\nfunction photoBase('));
 let release,calls=0;const prior=new Promise(resolve=>{release=resolve});
 const ctx={syncing:prior,syncNow:async()=>{calls++;return 'new authoritative sync'}};
 vm.runInNewContext(part+'\nglobalThis.run=syncPhotoFresh;',ctx);
 const pending=ctx.run();await Promise.resolve();assert.equal(calls,0);
 ctx.syncing=null;release();assert.equal(await pending,'new authoritative sync');assert.equal(calls,1);
 assert.equal(await ctx.run(),'new authoritative sync');assert.equal(calls,2);
});
