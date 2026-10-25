// W2 item 0: no screen may depend on the browser's native confirm(). Some in-app browsers, embedded
// frames and review tools suppress it without UI and it then returns false, so the action looks dead.
// Every confirmation goes through the app's own dialog (AtokoreConfirm in common-v45.js).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'../atokore-live-v125');
const NATIVE=/(^|[^A-Za-z0-9_$.])(?:window\.|root\.|self\.)?confirm\s*(?:\?\.)?\(/g;
test('no script calls native confirm()',()=>{
 const found=[];
 for(const file of fs.readdirSync(base).filter(f=>f.endsWith('.js'))){
  fs.readFileSync(path.join(base,file),'utf8').split('\n').forEach((line,i)=>{
   if(/^\s*(\/\/|\*)/.test(line))return;
   for(const m of line.matchAll(NATIVE))found.push(file+':'+(i+1)+': '+line.trim().slice(Math.max(0,m.index-20),m.index+60));
  });
 }
 assert.deepEqual(found,[]);
});
test('legacy confirm() calls left in index.html are all replaced before the app is usable',()=>{
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 // The enclosing legacy function of each confirm( call.
 const legacy=[...html.matchAll(/[^A-Za-z.]confirm\(/g)].map(m=>[...html.slice(0,m.index).matchAll(/function (\w+)\(/g)].pop()[1]).sort();
 assert.deepEqual(legacy,['delItem','deleteRoutine','deleteSelectedBuy','deleteSelectedStock']);
 const stability=fs.readFileSync(path.join(base,'stability.js'),'utf8');
 for(const name of ['delItem','deleteSelectedBuy','deleteSelectedStock'])assert.match(stability,new RegExp('window\\.'+name+'='),name+' is replaced by stability.js');
 assert.match(fs.readFileSync(path.join(base,'routine-catalog-v20.js'),'utf8'),/root\.deleteRoutine=function/,'deleteRoutine is replaced by routine-catalog-v20.js');
});
