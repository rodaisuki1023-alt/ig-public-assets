// Safe trial builder (Phase 7): no connection settings, own storage/photo DB/SW caches, CSP, noindex,
// OCR hidden, manifest of every file, and fail-closed on forbidden strings.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),src=path.join(root,'atokore-live-v125'),builder=path.join(root,'scripts/atokore/build-safe-trial.py');
const build=(source,dest)=>execFileSync('python3',['-I',builder,source,dest,'19'],{env:{...process.env,ATOKORE_BUILD_SHA:'0123456789abcdef0123456789abcdef01234567'},stdio:'pipe'}).toString();
test('safe trial: null config, no Supabase/keys, own storage, photo DB and SW caches, CSP and noindex, manifest',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atk-safe-')),dest=path.join(dir,'site');
 try{
  build(src,dest);
  const read=f=>fs.readFileSync(path.join(dest,f),'utf8');
  assert.match(read('household-config-v37.js'),/window\.ATOKORE_HOUSEHOLD_CONFIG = null;/);
  const all=fs.readdirSync(dest).filter(f=>/\.(js|html|json)$/.test(f)).map(read).join('\n');
  assert.doesNotMatch(all,/supabase\.co|sb_publishable_|sb_secret_|\batokorePreview/);
  assert.match(read('product-photos-v30.js'),/atokoreSafeTrialProductPhotosV19/);
  assert.match(read('service-worker.js'),/'atokore-safe-trial-shell:'/);
  assert.match(read('service-worker.js'),/'atokore-safe-trial-ocr:'/);
  const html=read('index.html');
  assert.match(html,/<meta http-equiv="Content-Security-Policy" content="default-src 'self';[^"]*connect-src 'self';/);
  assert.match(html,/<meta name="robots" content="noindex, nofollow, noarchive">/);
  assert.match(html,/安全な試用版 v19/);
  assert.match(html,/trial-v19-0123456/);
  assert.doesNotMatch(html,/ATOKORE_RECEIPT_EXPERIMENTAL\s*=\s*true/);
  assert.match(read('_headers'),/X-Robots-Tag: noindex, nofollow, noarchive/);
  assert.match(read('_headers'),/frame-ancestors 'none'/);
  const vercel=JSON.parse(read('vercel.json'));assert.ok(vercel.headers[0].headers.some(h=>h.key==='X-Robots-Tag'));
  const m=JSON.parse(read('SAFE_TRIAL_MANIFEST.json'));
  assert.equal(m.source_commit,'0123456789abcdef0123456789abcdef01234567');
  assert.equal(m.checks.household_config,'null');
  assert.equal(m.files['index.html'],require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(dest,'index.html'))).digest('hex'));
  assert.match(read('family.js'),/family sync is intentionally disabled/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('safe trial: a source that would ship a key or turn OCR on is refused',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atk-safe-bad-'));
 try{
  for(const [file,inject] of [['units-v51.js','\nconst k="sb_secret_abcdefghijklmnop";'],['units-v51.js','\nwindow.ATOKORE_RECEIPT_EXPERIMENTAL = true;'],['units-v51.js','\nfetch("https://abcdefghijklmnopqrst.supabase.co/rest");']]){
   const copy=path.join(dir,'src');fs.rmSync(copy,{recursive:true,force:true});fs.cpSync(src,copy,{recursive:true});
   fs.appendFileSync(path.join(copy,file),inject);
   assert.throws(()=>build(copy,path.join(dir,'out')),/safe build refused/,inject);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
