// Experimental, isolated security contract. Does not exercise real CDN/Storage HTTP.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const mod = import(pathToFileURL(path.join(__dirname, '../scripts/atokore/photo-gateway-policy.mjs')).href);
const hh = 'f2e33d46-bef7-4ed5-abb1-2e0d39b6c414';
const sid = 'qa_c0e4b6f7a9_item';
const file = '34f20801-5e2a-4bc5-967e-e77cd4c09d1b.jpg';
const photo = hh+'/'+sid+'/'+file;
const uid = 'd0088095-0c74-4ebc-a8eb-f88c2750a796';
const ok = extra => ({
  operation: 'read', path: photo, accessToken: 'synthetic-only',
  verifySession: async () => ({ id: uid }),
  checkCurrentAccess: async () => true,
  ...extra
});

test('gateway contract: accepts only exact UUID/record/JPEG paths', async () => {
  const {parsePhotoPath} = await mod;
  assert.equal(parsePhotoPath(photo).householdId, hh);
  assert.equal(parsePhotoPath(photo).recordId, sid);
  for (const invalid of [
    '', null, 'https://example.invalid/a.jpg',
    hh+'/../'+file, hh+'/x/'+file, hh+'/'+sid+'/../../'+file,
    hh+'/'+sid+'/'+file+'?v=1', hh+'/'+sid+'/'+file.replace('.jpg','.png'),
    hh+'/'+sid+'/'+file.toUpperCase(), 'not-a-uuid/'+sid+'/'+file
  ]) assert.equal(parsePhotoPath(invalid), null, String(invalid));
});

test('gateway contract: no explicit trusted callbacks or auth token means deny', async () => {
  const {authorizePhotoOperation: authorize} = await mod;
  for (const input of [
    {path: photo, operation: 'read', accessToken: 'a'},
    ok({verifySession: undefined}),
    ok({checkCurrentAccess: undefined}),
    ok({accessToken: ''}),
    ok({operation: 'GET'}),
    ok({path: hh+'/../'+file}),
  ]) assert.equal((await authorize(input)).allowed, false);
});

test('gateway contract: membership rechecked for EACH request and fails closed after removal', async () => {
  const {authorizePhotoOperation: authorize} = await mod;
  let member = true, verifications=0, checks=0;
  const input = ok({
    verifySession: async () => {verifications++; return {id:uid}},
    checkCurrentAccess: async ({userId,householdId,recordId}) => {
      checks++;
      assert.equal(userId,uid);
      assert.equal(householdId,hh);
      assert.equal(recordId,sid);
      return member;
    }
  });
  assert.equal((await authorize(input)).allowed,true);
  member=false;
  assert.deepEqual((await authorize(input)).allowed,false);
  assert.equal(verifications,2);
  assert.equal(checks,2);
});

test('gateway contract: cross-household, missing account or network error never allow', async () => {
  const {authorizePhotoOperation: authorize} = await mod;
  assert.equal((await authorize(ok({checkCurrentAccess: async () => false}))).reason,'membership');
  assert.equal((await authorize(ok({verifySession: async () => null}))).reason,'auth');
  assert.equal((await authorize(ok({verifySession: async () => {throw Error('offline')}}))).reason,'unavailable');
  assert.equal((await authorize(ok({checkCurrentAccess: async () => {throw Error('db_down')}}))).reason,'unavailable');
});

test('gateway contract: write requires plausible image/jpeg bytes within 80KiB', async () => {
  const {authorizePhotoOperation: authorize, validJpegBytes, PHOTO_MAX_BYTES} = await mod;
  const bytes = Uint8Array.from([0xff,0xd8,0xff,0xd9]);
  assert.equal(validJpegBytes(bytes),true);
  assert.equal((await authorize(ok({operation:'write',contentType:'image/jpeg',jpegBytes:bytes}))).allowed,true);
  for (const bad of [
    ok({operation:'write',contentType:'text/plain',jpegBytes:bytes}),
    ok({operation:'write',contentType:'image/jpeg',jpegBytes:Uint8Array.from([1,2,3,4])}),
    ok({operation:'write',contentType:'image/jpeg',jpegBytes:new Uint8Array(PHOTO_MAX_BYTES+1)}),
    ok({operation:'write',contentType:'image/jpeg',jpegBytes:undefined})
  ]) assert.equal((await authorize(bad)).reason,'jpeg_invalid');
});
