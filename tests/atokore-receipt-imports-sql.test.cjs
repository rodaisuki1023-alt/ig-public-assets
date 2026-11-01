// v49 audit: family-wide receipt import records (server side, real migrations in PGlite). Isolated test
// database only; nothing here touches a real Supabase project.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, call } = require('./household/pg.cjs');
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', C = '00000000-0000-4000-8000-00000000000c';
const FP = 'a'.repeat(64), FP2 = 'b'.repeat(64);

async function family() {
  const db = await createDb();
  await call(db, A, 'hh_create', { p_name: 'わが家', p_display_name: 'パパ' });
  const { code } = await call(db, A, 'hh_invite_create');
  await call(db, B, 'hh_join', { p_code: code, p_display_name: 'ママ' });
  return db;
}

test('the first claim wins; the other member is told who has it and in what state', async () => {
  const db = await family();
  assert.deepEqual(await call(db, A, 'hh_receipt_claim', { p_fingerprint: FP }), { claimed: true, state: 'pending', mine: true });
  let other = await call(db, B, 'hh_receipt_claim', { p_fingerprint: FP });
  assert.equal(other.claimed, false);
  assert.equal(other.state, 'pending');
  assert.equal(other.who, 'パパ');
  await call(db, A, 'hh_receipt_finish', { p_fingerprint: FP, p_done: true });
  other = await call(db, B, 'hh_receipt_claim', { p_fingerprint: FP });
  assert.equal(other.state, 'done');
  assert.equal(other.claimed, false);
  // The owner retrying (for example after a failed save) is not blocked by their own record.
  assert.equal((await call(db, A, 'hh_receipt_claim', { p_fingerprint: FP })).claimed, true);
});

test('choosing "a different purchase" goes ahead without changing the existing record', async () => {
  const db = await family();
  await call(db, A, 'hh_receipt_claim', { p_fingerprint: FP });
  await call(db, A, 'hh_receipt_finish', { p_fingerprint: FP, p_done: true });
  const forced = await call(db, B, 'hh_receipt_claim', { p_fingerprint: FP, p_force: true });
  assert.equal(forced.claimed, true);
  assert.equal(forced.forced, true);
  const rows = (await db.query('select state, claimed_by from atokore_private.receipt_imports')).rows;
  assert.deepEqual(rows, [{ state: 'done', claimed_by: A }]);
  // B finishing does not change A's record either.
  assert.equal((await call(db, B, 'hh_receipt_finish', { p_fingerprint: FP, p_done: true })).ok, false);
});

test('giving up releases only one\'s own pending reservation; an abandoned one can be taken over', async () => {
  const db = await family();
  await call(db, A, 'hh_receipt_claim', { p_fingerprint: FP });
  assert.equal((await call(db, B, 'hh_receipt_finish', { p_fingerprint: FP, p_done: false })).ok, false);
  assert.equal((await call(db, A, 'hh_receipt_finish', { p_fingerprint: FP, p_done: false })).ok, true);
  assert.equal((await call(db, B, 'hh_receipt_claim', { p_fingerprint: FP })).claimed, true);
  // B's reservation is left unfinished for more than 30 minutes: A may take it over.
  await db.query("update atokore_private.receipt_imports set updated_at = now() - interval '31 minutes'");
  const over = await call(db, A, 'hh_receipt_claim', { p_fingerprint: FP });
  assert.equal(over.claimed, true);
  assert.equal(over.tookOver, true);
  // A finished import is never taken over.
  await call(db, A, 'hh_receipt_finish', { p_fingerprint: FP, p_done: true });
  await db.query("update atokore_private.receipt_imports set updated_at = now() - interval '2 days'");
  assert.equal((await call(db, B, 'hh_receipt_claim', { p_fingerprint: FP })).claimed, false);
});

test('households are separate, fingerprints are checked, non-members are refused', async () => {
  const db = await family();
  await call(db, C, 'hh_create', { p_name: '別の家', p_display_name: 'となり' });
  await call(db, A, 'hh_receipt_claim', { p_fingerprint: FP });
  assert.equal((await call(db, C, 'hh_receipt_claim', { p_fingerprint: FP })).claimed, true);
  await assert.rejects(call(db, A, 'hh_receipt_claim', { p_fingerprint: 'not-a-hash' }), e => e.code === '22023');
  const D = '00000000-0000-4000-8000-00000000000d';
  await assert.rejects(call(db, D, 'hh_receipt_claim', { p_fingerprint: FP2 }), e => e.code === '42501');
  await assert.rejects(call(db, null, 'hh_receipt_claim', { p_fingerprint: FP2 }));
  // No product, price, member or payment data is stored: only the hash and who/when.
  const cols = (await db.query("select column_name from information_schema.columns where table_schema='atokore_private' and table_name='receipt_imports' order by ordinal_position")).rows.map(r => r.column_name);
  assert.deepEqual(cols, ['household_id', 'fingerprint', 'state', 'claimed_by', 'claimed_at', 'updated_at']);
});
