/* Atokore v49 receipt image preparation — stage 1 of reading a receipt, no network.
 * Photos of receipts usually show a table or floor around the paper, are often taken sideways, and
 * have shadows. The OCR reads the background as text and appends it to product lines, and cannot read
 * sideways text at all. This finds the paper, crops it, turns it upright (when the paper is wider than
 * tall the text runs vertically), enlarges small print and evens out uneven light. Nothing is guessed
 * about the content: if the paper cannot be found, the whole picture is used as before.
 */
(function(root){
'use strict';
const MAX_SIDE=400; // analysis size for finding the paper
// iOS Safari limits canvas area; keep the prepared image well below it.
const MAX_AREA=11e6, TARGET_W=1700, MIN_W=900;

function loadImage(file){
 return new Promise((res,rej)=>{const u=URL.createObjectURL(file),im=new Image();
  im.onload=()=>{URL.revokeObjectURL(u);res(im)};im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('画像を読み込めません'))};im.src=u});
}
function canvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c}
function ctx(c){return c.getContext('2d',{willReadFrequently:true})}

// Paper is white and unsaturated; wood, tables and cloth are coloured or darker. "Whiteness" is the
// lowest colour channel minus the colour spread, thresholded with Otsu's method.
function otsu(hist,total){let sum=0;for(let t=0;t<256;t++)sum+=t*hist[t];let sB=0,wB=0,best=-1,th=128;
 for(let t=0;t<256;t++){wB+=hist[t];if(!wB)continue;const wF=total-wB;if(!wF)break;sB+=t*hist[t];const mB=sB/wB,mF=(sum-sB)/wF,v=wB*wF*(mB-mF)*(mB-mF);if(v>best){best=v;th=t}}return th}
function paperBox(src,w,h){
 const sc=Math.min(1,MAX_SIDE/Math.max(w,h)),sw=Math.max(1,Math.round(w*sc)),sh=Math.max(1,Math.round(h*sc)),c=canvas(sw,sh),x=ctx(c);
 x.drawImage(src,0,0,sw,sh);const p=x.getImageData(0,0,sw,sh).data,n=sw*sh,wh=new Uint8Array(n),hist=new Array(256).fill(0);
 for(let i=0,k=0;k<n;i+=4,k++){const r=p[i],g=p[i+1],b=p[i+2],mn=Math.min(r,g,b),mx=Math.max(r,g,b),v=Math.max(0,Math.min(255,mn-(mx-mn)));wh[k]=v;hist[v]++}
 const th=otsu(hist,n);
 // Paper must be clearly whiter than the background; a plain scan or screenshot is used as it is.
 let fg=0;for(let k=0;k<n;k++)if(wh[k]>th)fg++;
 if(th<60||fg<n*0.06||fg>n*0.92)return null;
 // Largest connected white region (the receipt), with a 1-pixel closing so printed text does not split it.
 const mask=new Uint8Array(n);for(let k=0;k<n;k++)mask[k]=wh[k]>th?1:0;
 const closed=new Uint8Array(n);
 for(let y=0;y<sh;y++)for(let xx=0;xx<sw;xx++){let on=0;for(let dy=-1;dy<=1&&!on;dy++)for(let dx=-1;dx<=1;dx++){const yy=y+dy,x2=xx+dx;if(yy>=0&&yy<sh&&x2>=0&&x2<sw&&mask[yy*sw+x2]){on=1;break}}closed[y*sw+xx]=on}
 const label=new Int32Array(n).fill(-1),stack=new Int32Array(n);let best=null;
 for(let s=0;s<n;s++){if(!closed[s]||label[s]>=0)continue;let top=0,area=0,x0=sw,y0=sh,x1=0,y1=0;stack[top++]=s;label[s]=s;
  while(top){const k=stack[--top],yy=(k/sw)|0,xx=k-yy*sw;area++;if(xx<x0)x0=xx;if(xx>x1)x1=xx;if(yy<y0)y0=yy;if(yy>y1)y1=yy;
   const nb=[xx>0?k-1:-1,xx<sw-1?k+1:-1,yy>0?k-sw:-1,yy<sh-1?k+sw:-1];for(const q of nb)if(q>=0&&closed[q]&&label[q]<0){label[q]=s;stack[top++]=q}}
  if(!best||area>best.area)best={area,x0,y0,x1,y1}}
 if(!best||best.area<n*0.05)return null;
 const m=Math.round(Math.max(sw,sh)*0.012),bx0=Math.max(0,best.x0-m),by0=Math.max(0,best.y0-m),bx1=Math.min(sw-1,best.x1+m),by1=Math.min(sh-1,best.y1+m);
 const box={x:bx0/sc,y:by0/sc,w:(bx1-bx0+1)/sc,h:(by1-by0+1)/sc,share:best.area/n};
 // The whole frame is paper (close-up photo): nothing to crop.
 if(box.w>w*0.97&&box.h>h*0.97)return null;
 return box;
}

// Flatten shadows and folds: divide by a heavily blurred copy (the light), then stretch the contrast.
function boxBlur(src,w,h,r){
 const ii=new Float64Array((w+1)*(h+1));
 for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=src[y*w+x];ii[(y+1)*(w+1)+x+1]=ii[y*(w+1)+x+1]+row}}
 const out=new Float32Array(w*h);
 for(let y=0;y<h;y++){const ya=Math.max(0,y-r),yb=Math.min(h,y+r+1);for(let x=0;x<w;x++){const xa=Math.max(0,x-r),xb=Math.min(w,x+r+1);
  out[y*w+x]=(ii[yb*(w+1)+xb]-ii[ya*(w+1)+xb]-ii[yb*(w+1)+xa]+ii[ya*(w+1)+xa])/((yb-ya)*(xb-xa))}}
 return out;
}
function evenLight(c){
 const w=c.width,h=c.height,x=ctx(c),d=x.getImageData(0,0,w,h),p=d.data,g=new Float32Array(w*h);
 for(let i=0,k=0;k<g.length;i+=4,k++)g[k]=p[i]*.299+p[i+1]*.587+p[i+2]*.114;
 // The light is estimated on a reduced copy (fast on phones), then read back at full size.
 const f=4,sw=Math.max(1,Math.floor(w/f)),sh=Math.max(1,Math.floor(h/f)),small=new Float32Array(sw*sh);
 for(let y=0;y<sh;y++)for(let xx=0;xx<sw;xx++){let m=0;for(let dy=0;dy<f;dy++)for(let dx=0;dx<f;dx++){const v=g[(y*f+dy)*w+xx*f+dx];if(v>m)m=v}small[y*sw+xx]=m}
 const light=boxBlur(small,sw,sh,Math.max(4,Math.round(Math.min(sw,sh)*0.04)));
 const out=new Float32Array(w*h);const hist=new Array(256).fill(0);
 for(let y=0;y<h;y++)for(let xx=0;xx<w;xx++){const k=y*w+xx,l=light[Math.min(sh-1,(y/f)|0)*sw+Math.min(sw-1,(xx/f)|0)]||255,v=Math.max(0,Math.min(255,255*g[k]/Math.max(40,l)));out[k]=v;hist[v|0]++}
 // Stretch: the darkest 1% becomes black, paper stays white.
 let acc=0,lo=0;const total=w*h;for(let t=0;t<256;t++){acc+=hist[t];if(acc>=total*0.01){lo=t;break}}
 const span=Math.max(30,235-lo);
 for(let i=0,k=0;k<out.length;i+=4,k++){const v=Math.max(0,Math.min(255,Math.round((out[k]-lo)*255/span)));p[i]=p[i+1]=p[i+2]=v;p[i+3]=255}
 x.putImageData(d,0,0);return c;
}

// Draw the cropped paper turned by `turn` degrees (0, 90 or -90), at a size the OCR reads well.
function render(src,box,turn){
 const bw=box.w,bh=box.h,side=Math.abs(turn)===90,uw=side?bh:bw,uh=side?bw:bh;
 let sc=Math.max(MIN_W/uw,Math.min(2.5,TARGET_W/uw));
 if(uw*sc*uh*sc>MAX_AREA)sc=Math.sqrt(MAX_AREA/(uw*uh));
 const pad=24,c=canvas(uw*sc+pad*2,uh*sc+pad*2),x=ctx(c);
 x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';
 x.save();x.translate(c.width/2,c.height/2);x.rotate(turn*Math.PI/180);
 x.drawImage(src,box.x,box.y,bw,bh,-bw*sc/2,-bh*sc/2,bw*sc,bh*sc);x.restore();
 return evenLight(c);
}

// Returns the prepared image(s). When the paper lies sideways both turns are returned and the caller
// keeps the one the OCR reads with higher confidence (the text direction cannot be told from shape).
async function prepare(file,opt={}){
 const im=await loadImage(file),w=im.naturalWidth||im.width,h=im.naturalHeight||im.height;
 if(!w||!h)throw new Error('画像サイズを取得できません');
 const found=paperBox(im,w,h),box=found||{x:0,y:0,w,h,share:1};
 const turn=Number(opt.turn)||0;
 const sideways=!opt.turn&&box.w>box.h*1.15;
 const turns=opt.turn!==undefined&&opt.turn!==null?[turn]:sideways?[90,-90]:[0];
 // render(turn): another orientation on demand (the shape is only a hint: a short receipt can be wider than tall).
 return {found:!!found,box,sideways,fixedTurn:opt.turn!==undefined&&opt.turn!==null,candidates:turns.map(t=>({turn:t,canvas:render(im,box,t)})),render:t=>({turn:t,canvas:render(im,box,t)})};
}
// A small strip from the top of a candidate, used to compare the two turns cheaply.
function strip(c,share=0.35){const h=Math.max(1,Math.round(c.height*share)),s=canvas(c.width,h);ctx(s).drawImage(c,0,0,c.width,h,0,0,c.width,h);return s}

root.AtokoreReceiptImage=Object.freeze({prepare,strip,paperBox,otsu});
})(typeof window!=='undefined'?window:globalThis);
