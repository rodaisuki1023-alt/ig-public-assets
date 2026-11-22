// v50 two-iPhone family acceptance copy at /family/ of the protected owner review (PR #107).
// Builds the review output in a temp copy and checks that only /family/ can share, only on the
// protected host, with the trial backend's publishable key and storage separate from the root app.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('fs');const os=require('os');const path=require('path');const vm=require('vm');
const {execFileSync}=require('child_process');
const repo=path.join(__dirname,'..');
const HOST='https://atokore-v50-owner-review-20261122.vercel.app';
let out;
test.before(()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'atk-family-'));
 for(const d of ['atokore-live-v125','scripts','tests/manual'])fs.cpSync(path.join(repo,d),path.join(tmp,d),{recursive:true});
 const run=args=>execFileSync('python3',['-I',...args],{cwd:tmp,encoding:'utf8'});
 run(['scripts/atokore/build-local-review.py','atokore-live-v125','_local_review','19']);
 run(['scripts/atokore/attach-synthetic-storage-qa.py','_local_review']);
 run(['scripts/atokore/attach-family-acceptance.py','atokore-live-v125','_local_review']);
 assert.match(run(['scripts/atokore/verify-iphone-review-build.py','_local_review']),/\/family\/ acceptance copy/);
 out=path.join(tmp,'_local_review');
});
const read=f=>fs.readFileSync(path.join(out,f),'utf8');
const configAt=(file,href)=>{const u=new URL(href);const w={location:{origin:u.origin,pathname:u.pathname,href}};vm.runInNewContext(read(file),{window:w,location:w.location});return w.ATOKORE_HOUSEHOLD_CONFIG};

test('sharing is on only for /family/ on the protected review host',()=>{
 const on=configAt('family/household-config-v37.js',HOST+'/family/');
 assert.equal(on.url,'https://vzyxurodowpjltwbgbyc.supabase.co');
 assert.match(on.anonKey,/^sb_publishable_/);
 assert.deepEqual([on.google,on.guest,on.email],[true,true,false]);
 for(const href of [HOST+'/',HOST+'/familyx/',HOST+'/qa/family/','https://rodaisuki1023-alt.github.io/family/','http://127.0.0.1:4719/family/','https://atokore-v50-owner-review-20261122.vercel.app.evil.test/family/'])
  assert.equal(configAt('family/household-config-v37.js',href),null,href);
 // The root app stays family-disabled even on the protected host.
 assert.equal(configAt('household-config-v37.js',HOST+'/family/'),null);
});
test('root app and /family/ never share storage keys, and production keys are absent',()=>{
 const famJs=fs.readdirSync(path.join(out,'family')).filter(f=>/\.(js|html)$/.test(f)).map(f=>read('family/'+f)).join('\n');
 const rootJs=fs.readdirSync(out).filter(f=>/\.(js|html)$/.test(f)).map(f=>read(f)).join('\n');
 assert.match(famJs,/atokorePreviewTrialV50/);assert.doesNotMatch(famJs,/atokorePreview\w*V19\b/);
 assert.match(rootJs,/atokorePreviewTrialV19/);assert.doesNotMatch(rootJs,/atokorePreview\w*V50\b/);
 for(const k of ['atokoreTrialV4','atokoreHouseholdSessionV1','atokoreOnboardingV1'])assert.doesNotMatch(famJs+rootJs,new RegExp('\\b'+k+'\\b'));
});
test('the acceptance copy ships no secret, warns against real data and keeps receipt OCR held',()=>{
 const all=fs.readdirSync(path.join(out,'family'),{recursive:true}).filter(f=>/\.(js|html|json|webmanifest)$/.test(f)).map(f=>read(path.join('family',f))).join('\n');
 assert.doesNotMatch(all,/sb_secret_|service_role/);
 const html=read('family/index.html');
 assert.match(html,/実際の家族の名前・在庫・写真は入力しないでください/);
 assert.match(html,/content="共有テスト"/);
 assert.match(read('family/insights-v45.js'),/doc\.title='あとこれ｜家族共有 受入テスト v50'/);assert.doesNotMatch(read('insights-v45.js'),/家族共有 受入テスト/);
 assert.match(html,/window\.ATOKORE_RECEIPT_EXPERIMENTAL=window\.ATOKORE_RECEIPT_EXPERIMENTAL===true/);
 const sw=read('family/service-worker.js');assert.match(sw,/registration\.scope/);
 assert.equal(JSON.parse(read('family/manifest.webmanifest')).scope,'./');
});
test('vercel.json builds the acceptance copy before the fail-closed verifier and fixes the bare /family path',()=>{
 const c=JSON.parse(fs.readFileSync(path.join(repo,'vercel.json'),'utf8'));
 const cmd=c.buildCommand;
 assert.ok(cmd.indexOf('attach-family-acceptance.py')>cmd.indexOf('build-local-review.py'));
 assert.ok(cmd.indexOf('attach-family-acceptance.py')<cmd.indexOf('verify-iphone-review-build.py'));
 assert.deepEqual(c.redirects,[{source:'/family',destination:'/family/',permanent:false}]);
});
