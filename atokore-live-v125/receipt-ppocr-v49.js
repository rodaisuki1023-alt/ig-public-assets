/* Atokore v49 on-device OCR — stage 2 of reading a receipt. Runs in the browser; the photo never
 * leaves the phone. PP-OCRv6 (PaddleOCR, Apache-2.0; ONNX conversion by RapidOCR, Apache-2.0) with
 * onnxruntime-web (MIT). Compared with the previous OCR (tesseract.js) it reads the half-width katakana
 * that Japanese POS receipts use ("ﾃｽﾄｸﾞﾐ", "ﾃｽﾄﾊﾞﾀｰ") — measured on real receipts, see
 * docs/atokore-receipt-quality-v49.md.
 *
 * Pipeline (same constants as RapidOCR 3.10, so results match the measured ones):
 *   image ≤ 2000 px → text detection (DB, shorter side 736) → boxes → text recognition (height 48,
 *   CTC) → { box, text, score } per text run. receipt-ocr-lines-v49.js rebuilds receipt lines.
 * Models are fetched once from this site (./ocr/) and then served from the browser cache.
 */
(function(root){
'use strict';
// v49 audit: everything is served from this site (./ocr/), checked against its SHA-256 after download, and
// kept by the service worker; a damaged cached copy is fetched again once. onnxruntime-web 1.30.0 files are
// byte-identical to the npm package (hashes checked against jsDelivr when vendored).
const ORT_VERSION='1.30.0',BASE='./ocr/';
const FILES={
 runtime:{name:'ort.wasm.min.js',sha256:'faece07e84faa9001f5104bbe4e5c70861d06cb2376a0dea1fa0ad33a67adc81',bytes:50196},
 loader:{name:'ort-wasm-simd-threaded.mjs',sha256:'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b',bytes:24381},
 wasm:{name:'ort-wasm-simd-threaded.wasm',sha256:'3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2',bytes:14239897},
 det:{name:'ppocrv6-det-small-int8.onnx',sha256:'d1de8192b9c8c0e68a4c341605604b76b7c18d15b0e6167624f49e1e484f7cdb',bytes:2674015},
 rec:{name:'ppocrv6-rec-small.onnx',sha256:'6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884',bytes:21234383},
 dict:{name:'ppocrv6-dict.txt',sha256:'f7aa897ca828a4c7c9e2739c30f9161a33306d532f020bcdb91dcfb664a5507e',bytes:74946}
};
const RUNTIME_SRI='sha256-+uzgfoT6qQAfUQS75OXHCGHQbLI3ag3qH6CtM6Z63IE=';
// Largest first download: models and runtime, uncompressed (the server may send less when it compresses).
const DOWNLOAD_MB=Math.round(Object.values(FILES).reduce((s,f)=>s+f.bytes,0)/1e6);
const MAX_SIDE=2000,DET_MIN_SIDE=736,DET_THRESH=0.3,BOX_THRESH=0.5,UNCLIP=1.6,REC_H=48,BATCH=6,BAND=24;
// Short runs (prices, codes) are padded only to their own width instead of RapidOCR's 320 px minimum: on the
// measured receipts one name in 69 read slightly worse and reading took about a fifth less time.
const MIN_RATIO=Number(root.ATOKORE_OCR_MIN_RATIO)||2;
let state=null,loading=null;

const url=f=>new URL(BASE+f.name,document.baseURI).href;
async function hex(buf){const d=await crypto.subtle.digest('SHA-256',buf);return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function loadScript(f){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=url(f);s.async=true;s.integrity=RUNTIME_SRI;s.crossOrigin='anonymous';s.onload=res;s.onerror=()=>rej(new Error('読み取りの部品を読み込めません'));document.head.appendChild(s)})}
async function readBody(res,onBytes){
 if(!res.body||!res.body.getReader){const b=new Uint8Array(await res.arrayBuffer());onBytes&&onBytes(b.length);return b}
 const reader=res.body.getReader(),parts=[];let n=0;
 for(;;){const {done,value}=await reader.read();if(done)break;parts.push(value);n+=value.length;onBytes&&onBytes(value.length)}
 const out=new Uint8Array(n);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out;
}
// Fetch and verify one file. A copy that does not match (damaged cache, interrupted download, tampering)
// is removed from every cache and fetched once more from the network; a second mismatch stops reading.
// v49 2nd audit: the page, not the service worker, stores the parts, and only after their SHA-256 matched.
// Fetching, checking and storing are reported separately (storage()): a part that could not be stored (no
// space, storage blocked) still works for this reading, and the person is told it may be downloaded again.
// The cache is the one the service worker serves /ocr/ from (same name, see service-worker.js MODEL_CACHE).
const MODEL_CACHE='atokore-ocr:'+new URL('./',document.baseURI).pathname+':ppocrv6-1';
const TYPES={js:'text/javascript',mjs:'text/javascript',wasm:'application/wasm',onnx:'application/octet-stream',txt:'text/plain; charset=utf-8'};
let report=[];
async function store(f,bytes){
 try{const c=await caches.open(MODEL_CACHE);await c.put(url(f),new Response(bytes,{headers:{'content-type':TYPES[f.name.split('.').pop()]||'application/octet-stream'}}));
  return (await c.match(url(f)))?{stored:true,error:null}:{stored:false,error:'not_found_after_put'}}
 catch(e){console.warn('読み取りの部品を保存できませんでした',f.name,e&&e.name);return {stored:false,error:e&&e.name||'error'}}
}
async function fetchVerified(f,onBytes){
 let had=false;try{had=!!(await caches.match(url(f)))}catch(e){}
 for(let attempt=0;attempt<2;attempt++){
  // A stored copy is read from the cache directly (also without the service worker, e.g. offline).
  let res=null;if(had&&!attempt){try{res=await caches.match(url(f))}catch(e){res=null}}
  if(!res)res=await fetch(url(f),attempt?{cache:'reload'}:{});
  if(!res.ok)throw new Error('読み取りの部品を読み込めません（'+res.status+'）');
  const bytes=await readBody(res,onBytes);
  if(await hex(bytes)===f.sha256){
   const fromCache=had&&attempt===0,st=fromCache?{stored:true,error:null}:await store(f,bytes);
   report.push({file:f.name,fetched:true,verified:true,fromCache,stored:st.stored,error:st.error});
   return bytes;
  }
  report.push({file:f.name,fetched:true,verified:false,fromCache:had&&attempt===0,stored:false,error:'hash_mismatch'});
  try{for(const k of await caches.keys())await (await caches.open(k)).delete(url(f))}catch(e){console.warn(e)}
 }
 throw new Error('読み取りの部品が壊れています。通信の良い場所でもう一度お試しください。');
}
// After load(): which parts are kept on this device. allStored=false → the next reading or offline use may
// need the download again (the browser may also clear stored data later; that cannot be promised either way).
function storage(){const last=new Map();for(const r of report)if(r.verified)last.set(r.file,r);const ok=[...last.values()];
 return {checked:ok.length,allStored:ok.length===Object.keys(FILES).length&&ok.every(r=>r.stored),notStored:ok.filter(r=>!r.stored).map(r=>({file:r.file,error:r.error})),downloaded:ok.filter(r=>!r.fromCache).map(r=>r.file),entries:report.slice()}}
// True when every part is already in this browser's cache (no download needed): the data-use notice is
// shown again whenever it is not (for example after the site data was cleared).
async function cached(){try{for(const f of Object.values(FILES))if(!(await caches.match(url(f))))return false;return true}catch(e){return false}}
// Loads the runtime and the models once. onProgress(share 0..1) during the first download.
function load(onProgress){
 if(state)return Promise.resolve(state);
 if(loading)return loading;
 loading=(async()=>{
  const total=Object.values(FILES).reduce((s,f)=>s+f.bytes,0);let got=0;
  const tick=k=>{got+=k;onProgress&&onProgress(Math.min(1,got/total))};
  // The script itself is checked by the browser (subresource integrity); it is also kept for offline use.
  await fetchVerified(FILES.runtime,tick);
  if(!root.ort)await loadScript(FILES.runtime);
  const ort=root.ort;if(!ort)throw new Error('読み取りの部品を読み込めません');
  const [loader,wasm,det,rec,dict]=await Promise.all([fetchVerified(FILES.loader,tick),fetchVerified(FILES.wasm,tick),fetchVerified(FILES.det,tick),fetchVerified(FILES.rec,tick),fetchVerified(FILES.dict,tick)]);
  // The runtime gets the verified bytes, not a second download.
  ort.env.wasm.numThreads=1;ort.env.wasm.wasmBinary=wasm;
  ort.env.wasm.wasmPaths={mjs:URL.createObjectURL(new Blob([loader],{type:'text/javascript'}))};
  const opt={executionProviders:['wasm'],graphOptimizationLevel:'all'};
  const sDet=await ort.InferenceSession.create(det,opt),sRec=await ort.InferenceSession.create(rec,opt);
  // CTC classes: blank, the dictionary, then a space.
  const chars=['',...new TextDecoder().decode(dict).split('\n'),' '];
  state={ort,det:sDet,rec:sRec,chars};return state;
 })();
 loading.catch(()=>{loading=null});
 return loading;
}

function canvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c}
function ctx(c){return c.getContext('2d',{willReadFrequently:true})}
function resized(src,w,h){const c=canvas(w,h),x=ctx(c);x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';x.drawImage(src,0,0,c.width,c.height);return c}
// The models were trained on BGR images normalised to [-1, 1].
function toTensor(pixels,w,h,data,offset,stride){
 const plane=h*stride;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,o=offset+y*stride+x;
  data[o]=(pixels[i+2]/255-0.5)/0.5;data[o+plane]=(pixels[i+1]/255-0.5)/0.5;data[o+2*plane]=(pixels[i]/255-0.5)/0.5}
}

// Text detection: probability map → connected regions → boxes, expanded like DB's unclip.
function boxesFromMap(prob,w,h,scaleX,scaleY,W,H){
 const bin=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=y*w+x;
  // 2×2 dilation of the thresholded map.
  bin[k]=(prob[k]>DET_THRESH||(x>0&&prob[k-1]>DET_THRESH)||(y>0&&prob[k-w]>DET_THRESH)||(x>0&&y>0&&prob[k-w-1]>DET_THRESH))?1:0}
 const seen=new Uint8Array(w*h),stack=new Int32Array(w*h),out=[];
 for(let s=0;s<w*h;s++){
  if(!bin[s]||seen[s])continue;let top=0,x0=w,y0=h,x1=0,y1=0;stack[top++]=s;seen[s]=1;
  while(top){const k=stack[--top],y=(k/w)|0,x=k-y*w;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const yy=y+dy,xx=x+dx;if(yy<0||yy>=h||xx<0||xx>=w)continue;const q=yy*w+xx;if(bin[q]&&!seen[q]){seen[q]=1;stack[top++]=q}}}
  const bw=x1-x0,bh=y1-y0;if(Math.min(bw,bh)<3)continue;
  let sum=0,n=0;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){sum+=prob[y*w+x];n++}
  const score=sum/n;if(score<BOX_THRESH)continue;
  const d=bw*bh*UNCLIP/(2*(bw+bh)),ex0=x0-d,ey0=y0-d,ex1=x1+d,ey1=y1+d;
  if(Math.min(ex1-ex0,ey1-ey0)<5)continue;
  const X0=Math.max(0,Math.min(W,Math.round(ex0*scaleX))),Y0=Math.max(0,Math.min(H,Math.round(ey0*scaleY))),X1=Math.max(0,Math.min(W,Math.round(ex1*scaleX))),Y1=Math.max(0,Math.min(H,Math.round(ey1*scaleY)));
  if(X1-X0<2||Y1-Y0<2)continue;
  out.push({x:X0,y:Y0,w:X1-X0,h:Y1-Y0,score});
  if(out.length>=1000)break;
 }
 return out;
}
function ctcDecode(data,T,C,chars,offset){
 let text='',sum=0,n=0,prev=-1;
 for(let t=0;t<T;t++){let best=0,bp=-1;const base=offset+t*C;for(let c=0;c<C;c++){const v=data[base+c];if(v>bp){bp=v;best=c}}
  if(best!==0&&best!==prev){text+=chars[best]??'';sum+=bp;n++}prev=best}
 return {text,score:n?sum/n:0};
}

// Recognise the text runs in an upright receipt image. Returns [{ box: [[x,y]x4], text, score }].
// opt.stopAfter(itemsSoFar) → true stops reading further down the receipt (after the item list ends,
// payment, points and advertising are neither needed nor read). opt.onProgress(share 0..1).
async function recognize(source,opt={}){
 if(typeof opt==='function')opt={onProgress:opt};
 const S=await load(),t0=performance.now(),onProgress=opt.onProgress;
 const ow=source.width,oh=source.height,r=Math.max(ow,oh)>MAX_SIDE?MAX_SIDE/Math.max(ow,oh):1;
 const work=r<1?resized(source,ow*r,oh*r):source,W=work.width,H=work.height;
 // Detection input: shorter side 736 (enlarged or reduced), both sides multiples of 32. Receipt print
 // stays well above the size the detector needs, and the larger input only costs time.
 const dr=DET_MIN_SIDE/Math.min(W,H);
 const dw=Math.max(32,Math.round(Math.floor(W*dr)/32)*32),dh=Math.max(32,Math.round(Math.floor(H*dr)/32)*32);
 const dc=resized(work,dw,dh),dpix=ctx(dc).getImageData(0,0,dw,dh).data,dt=new Float32Array(3*dw*dh);
 toTensor(dpix,dw,dh,dt,0,dw);
 const dOut=await S.det.run({[S.det.inputNames[0]]:new S.ort.Tensor('float32',dt,[1,3,dh,dw])});
 const prob=dOut[S.det.outputNames[0]].data;
 const boxes=boxesFromMap(prob,dw,dh,W/dw,H/dh,W,H).sort((a,b)=>(a.y+a.h/2)-(b.y+b.h/2)),t1=performance.now();
 // Text running top-to-bottom gives tall boxes: the picture is sideways. Reported before reading so the
 // caller can turn it (a short receipt can be about as wide as it is tall, so its shape does not tell).
 if(opt.rejectVertical){const tall=boxes.filter(b=>b.h>b.w*1.3).length,wide=boxes.filter(b=>b.w>b.h*1.3).length;
  if(tall>=4&&tall>wide*1.5){const r=[];r.vertical=true;r.stats={detMs:Math.round(t1-t0),boxes:boxes.length,tall,wide};return r}}
 onProgress&&onProgress(0.2);
 // Recognition from the top down, a band of boxes at a time; inside a band crops are sorted by
 // width/height and run in small batches padded to the widest.
 const crop=b=>{let c=canvas(b.w,b.h);ctx(c).drawImage(work,b.x,b.y,b.w,b.h,0,0,b.w,b.h);
  if(b.h/b.w>=1.5){const rc=canvas(b.h,b.w),x=ctx(rc);x.translate(0,b.w);x.rotate(-Math.PI/2);x.drawImage(c,0,0);c=rc}
  return {b,c,ratio:c.width/c.height}};
 // v49 2nd audit: runs read with low confidence (or as nothing) are not text, but they are not forgotten:
 // their place is kept so the review screen can point at a possibly missed line.
 const out=[],dropped=[],sx=ow/W,sy=oh/H;let read=0,stopped=false;
 for(let band=0;band<boxes.length&&!stopped;band+=BAND){
  const crops=boxes.slice(band,band+BAND).map(crop),order=crops.map((_,i)=>i).sort((a,b)=>crops[a].ratio-crops[b].ratio),got=new Array(crops.length);
  for(let s=0;s<order.length;s+=BATCH){
   const ids=order.slice(s,s+BATCH),maxRatio=Math.max(MIN_RATIO,...ids.map(i=>crops[i].ratio)),iw=Math.floor(REC_H*maxRatio);
   const data=new Float32Array(ids.length*3*REC_H*iw);
   ids.forEach((id,k)=>{const cr=crops[id],rw=Math.min(iw,Math.ceil(REC_H*cr.ratio)),c=resized(cr.c,rw,REC_H),p=ctx(c).getImageData(0,0,rw,REC_H).data;
    toTensor(p,rw,REC_H,data,k*3*REC_H*iw,iw)});
   const res=await S.rec.run({[S.rec.inputNames[0]]:new S.ort.Tensor('float32',data,[ids.length,3,REC_H,iw])}),o=res[S.rec.outputNames[0]],[,T,C]=o.dims;
   ids.forEach((id,k)=>{const d=ctcDecode(o.data,T,C,S.chars,k*T*C),b=crops[id].b;
    got[id]={box:[[b.x*sx,b.y*sy],[(b.x+b.w)*sx,b.y*sy],[(b.x+b.w)*sx,(b.y+b.h)*sy],[b.x*sx,(b.y+b.h)*sy]],text:d.text,score:d.score}});
  }
  read+=crops.length;
  for(const g of got){if(g&&g.text&&g.score>=0.5)out.push(g);else if(g)dropped.push({box:g.box,score:g.score,empty:!g.text})}
  onProgress&&onProgress(0.2+0.8*read/boxes.length);
  if(opt.stopAfter&&opt.stopAfter(out))stopped=true;
 }
 // Timings for the evaluation tool; not shown to users.
 out.dropped=dropped;
 out.stats={detMs:Math.round(t1-t0),recMs:Math.round(performance.now()-t1),boxes:boxes.length,read,det:[dw,dh]};
 return out;
}
// Read a prepared receipt (AtokoreReceiptImage.prepare). When the paper lies sideways the text may run
// either way: the top of each turn is read briefly and the turn read with more confidence is kept.
function topOf(c){const h=Math.min(c.height,Math.round(c.width*0.8)),t=canvas(c.width,h);ctx(t).drawImage(c,0,0,c.width,h,0,0,c.width,h);return t}
function turned(c,turn){const t=canvas(c.height,c.width),x=ctx(t);x.translate(t.width/2,t.height/2);x.rotate(turn*Math.PI/180);x.drawImage(c,-c.width/2,-c.height/2);return t}
async function bestTurn(cands){let pick=cands[0],best=-1;for(const c of cands){const items=await recognize(topOf(c.canvas),{stopAfter:()=>true});const v=items.reduce((s,x)=>s+x.score*x.text.length,0);if(v>best){best=v;pick=c}}return pick}
async function readReceipt(prep,opt={}){
 let cands=prep.candidates;
 // Paper wider than tall was turned by a quarter; if the text then runs top-to-bottom, the picture was in fact
 // upright (a short receipt): read it as it is.
 if(cands.length>1&&prep.render){const probe=await recognize(topOf(cands[0].canvas),{rejectVertical:true,stopAfter:()=>true});if(probe.vertical)cands=[prep.render(0)]}
 let pick=cands.length>1?await bestTurn(cands):cands[0];
 // An explicit turn (the person chose "向きを変えて読み直す") is read as it is.
 let items=await recognize(pick.canvas,{...opt,rejectVertical:cands.length===1&&pick.turn===0&&!prep.fixedTurn});
 if(items.vertical){const base=pick;pick=await bestTurn([90,-90].map(t=>({turn:(base.turn||0)+t,canvas:turned(base.canvas,t)})));items=await recognize(pick.canvas,opt)}
 items.turn=pick.turn;items.canvas=pick.canvas;return items;
}
function ready(){return !!state}
root.AtokoreReceiptOcr=Object.freeze({load,cached,storage,MODEL_CACHE,recognize,readReceipt,ready,DOWNLOAD_MB,ORT_VERSION,FILES});
})(typeof window!=='undefined'?window:globalThis);
