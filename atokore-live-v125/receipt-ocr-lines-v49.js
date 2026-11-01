/* Atokore v49 — turn OCR text boxes into receipt lines. Pure logic, no network.
 * Detector-based OCR (PP-OCR) returns one box per text run: a product name and its price on the
 * same printed line come back as separate boxes. Receipt lines are rebuilt from the box positions:
 * boxes whose vertical centres are close belong to one line, ordered left to right.
 */
(function(root){
'use strict';
function geometry(b){
 const pts=Array.isArray(b.box)?b.box:[];const xs=pts.map(p=>+p[0]).filter(Number.isFinite),ys=pts.map(p=>+p[1]).filter(Number.isFinite);
 if(!xs.length||!ys.length)return null;
 const top=Math.min(...ys),bottom=Math.max(...ys);
 return {left:Math.min(...xs),right:Math.max(...xs),top,bottom,cy:(top+bottom)/2,h:Math.max(1,bottom-top)};
}
// items: [{ box: [[x,y]x4], text, score (0..1) }]  →  [{ text, confidence (0..100) }]
function groupBoxes(items){
 const boxes=(items||[]).map(it=>({...it,g:geometry(it)})).filter(b=>b.g&&String(b.text||'').trim());
 boxes.sort((a,b)=>a.g.cy-b.g.cy);
 const lines=[];
 for(const b of boxes){
  // Same line when the centres are within half of the smaller box height (receipt print is one size).
  let best=null,dist=Infinity;
  for(const l of lines.slice(-4)){const d=Math.abs(l.cy-b.g.cy);if(d<Math.min(l.h,b.g.h)*0.55&&d<dist){best=l;dist=d}}
  if(best){best.parts.push(b);best.cy=(best.cy*(best.parts.length-1)+b.g.cy)/best.parts.length;best.h=Math.max(best.h,b.g.h)}
  else lines.push({cy:b.g.cy,h:b.g.h,parts:[b]});
 }
 return lines.map(l=>{
  l.parts.sort((a,b)=>a.g.left-b.g.left);
  const scores=l.parts.map(p=>Number(p.score)).filter(Number.isFinite);
  return {text:l.parts.map(p=>String(p.text).trim()).join(' '),confidence:scores.length?Math.round(100*scores.reduce((s,n)=>s+n,0)/scores.length):null,top:Math.min(...l.parts.map(p=>p.g.top)),boxes:l.parts.length};
 });
}
root.AtokoreReceiptLines=Object.freeze({groupBoxes});
if(typeof module!=='undefined'&&module.exports)module.exports=root.AtokoreReceiptLines;
})(typeof window!=='undefined'?window:globalThis);
