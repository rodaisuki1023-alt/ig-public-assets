// Household sharing server rules, run against the real migration SQL in PGlite.
// Covers: access only through the API, isolation between households, idempotent retries,
// concurrent counters, delete/edit races, purchase completion once, invites, seats, leave/rejoin.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, call, asRole } = require('./household/pg.cjs');

const A = '00000000-0000-4000-8000-00000000000a'; // household 1 owner
const B = '00000000-0000-4000-8000-00000000000b'; // household 1 member
const C = '00000000-0000-4000-8000-00000000000c'; // another household
const D = '00000000-0000-4000-8000-00000000000d'; // not a member
let n = 0;
const opId = () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;
const create = (id, name, qty = 1, extra = {}) => ({ op_id: opId(), type: 'create', kind: 'item', id, fields: { name, cat: 'ベビー', unit: '袋', ...extra }, qty, ts: Date.now() });
const statuses = r => r.results.map(x => x.status);
async function pair() {
  const db = await createDb();
  await call(db, A, 'hh_create', { p_name: 'わが家', p_display_name: 'ママ' });
  const { code } = await call(db, A, 'hh_invite_create');
  await call(db, B, 'hh_join', { p_code: code, p_display_name: 'パパ' });
  return db;
}
const state = async (db, uid) => Object.fromEntries((await call(db, uid, 'hh_pull', { p_since: 0 })).records.map(r => [r.id, r]));

test('tables are closed: no direct reads or writes, signed-out callers cannot use the API', async () => {
  const db = await pair();
  for (const uid of [null, A]) {
    for (const sql of ['select * from atokore_private.records', 'select * from atokore_private.members', "insert into atokore_private.ops values ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000001','" + A + "',null,now(),'x',null,null,'{}','x')"]) {
      await assert.rejects(asRole(db, uid, sql), /permission denied/);
    }
  }
  await assert.rejects(call(db, null, 'hh_my'), /permission denied/);
  await assert.rejects(call(db, null, 'hh_push', { p_ops: [] }), /permission denied/);
});

test('another household can neither read nor write this household, and non-members are refused', async () => {
  const db = await pair();
  await call(db, A, 'hh_push', { p_ops: [create('item-diaper-m', 'パンパース テープ M', 2)] });
  await call(db, C, 'hh_create', { p_name: '別の家', p_display_name: 'よそ' });
  assert.deepEqual((await call(db, C, 'hh_pull', { p_since: 0 })).records, []);
  // Writing the same record id from another household creates that household's own record only.
  await call(db, C, 'hh_push', { p_ops: [{ op_id: opId(), type: 'add', kind: 'item', id: 'item-diaper-m', delta: 5 }] });
  assert.equal((await state(db, A))['item-diaper-m'].qty, 2);
  assert.deepEqual(await call(db, C, 'hh_changes', {}), []);
  for (const fn of ['hh_pull', 'hh_changes', 'hh_invite_create']) await assert.rejects(call(db, D, fn, {}), /not_member/);
  await assert.rejects(call(db, D, 'hh_push', { p_ops: [] }), /not_member/);
  assert.equal((await call(db, D, 'hh_my')).household, null);
});

test('retries and double taps apply each operation once', async () => {
  const db = await pair();
  const c = create('item-wipes-x', 'Rico おしりふき', 1);
  const add = { op_id: opId(), type: 'add', kind: 'item', id: 'item-wipes-x', delta: 2 };
  assert.deepEqual(statuses(await call(db, A, 'hh_push', { p_ops: [c, add] })), ['applied', 'applied']);
  // The response was lost and the device sends the same batch again, then once more from another device of the same person.
  assert.deepEqual(statuses(await call(db, A, 'hh_push', { p_ops: [c, add] })), ['duplicate', 'duplicate']);
  assert.deepEqual(statuses(await call(db, A, 'hh_push', { p_ops: [add], p_device: 'ipad' })), ['duplicate']);
  assert.equal((await state(db, B))['item-wipes-x'].qty, 3);
});

test('two people changing the same stock at the same time: both changes count, never below zero', async () => {
  const db = await pair();
  await call(db, A, 'hh_push', { p_ops: [create('item-milk-can', '明治 ほほえみ 缶', 3)] });
  // Both saw 3; A used one, B used one and bought two. Neither overwrites the other.
  await call(db, A, 'hh_push', { p_ops: [{ op_id: opId(), type: 'add', kind: 'item', id: 'item-milk-can', delta: -1 }] });
  await call(db, B, 'hh_push', { p_ops: [{ op_id: opId(), type: 'add', kind: 'item', id: 'item-milk-can', delta: -1 }, { op_id: opId(), type: 'add', kind: 'item', id: 'item-milk-can', delta: 2 }] });
  assert.equal((await state(db, A))['item-milk-can'].qty, 3);
  await call(db, A, 'hh_push', { p_ops: [{ op_id: opId(), type: 'add', kind: 'item', id: 'item-milk-can', delta: -5 }] });
  assert.equal((await state(db, B))['item-milk-can'].qty, 0);
});

test('a deleted product never comes back through a late edit or count change', async () => {
  const db = await pair();
  await call(db, A, 'hh_push', { p_ops: [create('item-old-tape', 'グーン テープ S', 1)] });
  const t = Date.now();
  await call(db, A, 'hh_push', { p_ops: [{ op_id: opId(), type: 'delete', kind: 'item', id: 'item-old-tape' }] });
  // B was offline and edited/used it before seeing the delete.
  const late = await call(db, B, 'hh_push', { p_ops: [
    { op_id: opId(), type: 'set', kind: 'item', id: 'item-old-tape', field: 'name', value: 'グーン テープ S（改）', ts: t - 1000 },
    { op_id: opId(), type: 'add', kind: 'item', id: 'item-old-tape', delta: 1 },
    create('item-old-tape', 'グーン テープ S', 4)] });
  assert.deepEqual(statuses(late), ['skipped_deleted', 'skipped_deleted', 'skipped_deleted']);
  const r = (await state(db, B))['item-old-tape'];
  assert.equal(r.deleted, true);
  assert.equal(r.fields.name, 'グーン テープ S');
});

test('field edits: the later edit wins per field, an older offline edit does not overwrite a newer one', async () => {
  const db = await pair();
  await call(db, A, 'hh_push', { p_ops: [create('item-soap-01', 'ボディソープ', 1)] });
  const now = Date.now();
  await call(db, A, 'hh_push', { p_ops: [{ op_id: opId(), type: 'set', kind: 'item', id: 'item-soap-01', field: 'place', value: '洗面所', ts: now }] });
  const stale = await call(db, B, 'hh_push', { p_ops: [
    { op_id: opId(), type: 'set', kind: 'item', id: 'item-soap-01', field: 'place', value: '収納', ts: now - 60000 },
    { op_id: opId(), type: 'set', kind: 'item', id: 'item-soap-01', field: 'memo', value: '詰替を買う', ts: now - 60000 }] });
  assert.deepEqual(statuses(stale), ['stale', 'applied']);
  const r = (await state(db, A))['item-soap-01'];
  assert.equal(r.fields.place, '洗面所');
  assert.equal(r.fields.memo, '詰替を買う');
  // A clock far in the future is clamped, so it cannot pin a field forever.
  await call(db, B, 'hh_push', { p_ops: [{ op_id: opId(), type: 'set', kind: 'item', id: 'item-soap-01', field: 'place', value: '未来', ts: now + 10 * 86400000 }] });
  await call(db, A, 'hh_push', { p_ops: [{ op_id: opId(), type: 'set', kind: 'item', id: 'item-soap-01', field: 'place', value: '洗面所', ts: now + 61000 }] });
  assert.equal((await state(db, B))['item-soap-01'].fields.place, '洗面所');
});

test('finishing the same purchase twice restocks once', async () => {
  const db = await pair();
  await call(db, A, 'hh_push', { p_ops: [create('item-diaper-l', 'メリーズ パンツ L', 1),
    { op_id: opId(), type: 'create', kind: 'buy', id: 'buy-diaper-l', fields: { name: 'メリーズ パンツ L', unit: '袋' }, qty: 2, ts: Date.now() }] });
  const done = () => ({ op_id: opId(), type: 'complete_buy', buy: 'buy-diaper-l', item: 'item-diaper-l', delta: 2, ts: Date.now() });
  assert.deepEqual(statuses(await call(db, A, 'hh_push', { p_ops: [done()] })), ['applied']);
  assert.deepEqual(statuses(await call(db, B, 'hh_push', { p_ops: [done()] })), ['skipped_completed']);
  const s = await state(db, A);
  assert.equal(s['item-diaper-l'].qty, 3);
  assert.equal(s['buy-diaper-l'].deleted, true);
  // A new item from the shopping list is created once as well.
  await call(db, B, 'hh_push', { p_ops: [{ op_id: opId(), type: 'create', kind: 'buy', id: 'buy-new-food', fields: { name: '和光堂 おかゆ', unit: '個' }, qty: 3, ts: Date.now() }] });
  const finish = id => ({ op_id: opId(), type: 'complete_buy', buy: 'buy-new-food', item: id, delta: 3, item_fields: { name: '和光堂 おかゆ', cat: '離乳食', unit: '個' }, ts: Date.now() });
  await call(db, A, 'hh_push', { p_ops: [finish('item-food-from-a')] });
  await call(db, B, 'hh_push', { p_ops: [finish('item-food-from-b')] });
  const after = await state(db, B);
  assert.equal(after['item-food-from-a'].qty, 3);
  assert.equal(after['item-food-from-b'], undefined);
});

test('bad operations are rejected one by one without losing the rest of the batch', async () => {
  const db = await pair();
  const r = await call(db, A, 'hh_push', { p_ops: [
    { op_id: 'not-a-uuid', type: 'add' },
    { op_id: opId(), type: 'create', kind: 'item', id: 'x', fields: { name: 'short id' } },
    { op_id: opId(), type: 'create', kind: 'item', id: 'item-noname-1', fields: { cat: '食料品' } },
    { op_id: opId(), type: 'create', kind: 'item', id: 'item-bigname-1', fields: { name: 'あ'.repeat(121) } },
    { op_id: opId(), type: 'create', kind: 'item', id: 'item-badkey-1', fields: { name: 'ok', '__proto__x': 1 } },
    { op_id: opId(), type: 'create', kind: 'item', id: 'item-negative', fields: { name: 'ok' }, qty: -3 },
    { op_id: opId(), type: 'drop_table', kind: 'item', id: 'item-diaper-m' },
    create('item-good-one', '卵', 6)] });
  assert.deepEqual(statuses(r), ['rejected:bad_op', 'rejected:bad_target', 'rejected:bad_fields', 'rejected:bad_fields', 'rejected:bad_fields', 'rejected:bad_qty', 'missing', 'applied']);
  await assert.rejects(call(db, A, 'hh_push', { p_ops: Array.from({ length: 201 }, () => create('item-' + opId().slice(-12), 'x')) }), /bad_batch/);
});

test('invites: single use, expire, can be revoked, replaced by a new one; wrong codes are rate limited', async () => {
  const db = await createDb();
  await call(db, A, 'hh_create', { p_name: 'わが家', p_display_name: 'ママ' });
  const first = await call(db, A, 'hh_invite_create');
  assert.match(first.code, /^[A-HJ-NP-Z2-9]{8}$/);
  const second = await call(db, A, 'hh_invite_create');
  assert.equal((await call(db, B, 'hh_join', { p_code: first.code, p_display_name: 'パパ' })).error, 'revoked_code');
  await call(db, A, 'hh_invite_revoke');
  assert.equal((await call(db, B, 'hh_join', { p_code: second.code, p_display_name: 'パパ' })).error, 'revoked_code');
  const third = await call(db, A, 'hh_invite_create');
  await db.exec(`update atokore_private.invites set expires_at = now() - interval '1 minute' where used_at is null and revoked_at is null`);
  assert.equal((await call(db, B, 'hh_join', { p_code: third.code, p_display_name: 'パパ' })).error, 'expired_code');
  const fourth = await call(db, A, 'hh_invite_create');
  // Lower case and a hyphen typed by hand still match.
  const typed = fourth.code.slice(0, 4).toLowerCase() + '-' + fourth.code.slice(4);
  assert.equal((await call(db, B, 'hh_join', { p_code: typed, p_display_name: 'パパ' })).me.role, 'member');
  assert.equal((await call(db, D, 'hh_join', { p_code: fourth.code, p_display_name: 'だれか' })).error, 'used_code');
  // The used code above was the first failure; nine more reach the limit of ten per hour.
  for (let i = 0; i < 9; i++) assert.equal((await call(db, D, 'hh_join', { p_code: 'ZZZZZZZZ', p_display_name: 'だれか' })).error, 'invalid_code');
  await assert.rejects(call(db, D, 'hh_join', { p_code: 'ZZZZZZZZ', p_display_name: 'だれか' }), /too_many_attempts/);
});

test('two accounts per household on the free plan; a second device of the same person is not a member', async () => {
  const db = await pair();
  await assert.rejects(call(db, A, 'hh_invite_create'), /seat_limit/);
  // The same person on another device signs in with the same account: still two members.
  const my = await call(db, B, 'hh_my');
  assert.equal(my.members.length, 2);
  assert.deepEqual(my.members.map(m => m.display_name), ['ママ', 'パパ']);
  assert.equal(my.household.seat_limit, 2);
});

test('leave keeps data, ownership passes on, re-joining works, and the last member archives without deleting', async () => {
  const db = await pair();
  await call(db, B, 'hh_push', { p_ops: [create('item-kept-1', 'ムーニー パンツ M', 2)] });
  await call(db, A, 'hh_leave');
  const b = await call(db, B, 'hh_my');
  assert.equal(b.me.role, 'owner');
  assert.equal(b.members.length, 1);
  await assert.rejects(call(db, A, 'hh_pull', { p_since: 0 }), /not_member/);
  const { code } = await call(db, B, 'hh_invite_create');
  await call(db, A, 'hh_join', { p_code: code, p_display_name: 'ママ' });
  assert.equal((await state(db, A))['item-kept-1'].qty, 2);
  await call(db, A, 'hh_leave');
  await call(db, B, 'hh_leave');
  assert.equal((await call(db, B, 'hh_my')).household, null);
  const rows = await db.query('select count(*)::int as n from atokore_private.records');
  assert.equal(rows.rows[0].n, 1, 'records are not deleted when everyone leaves');
  // Owner can remove a member; a member cannot remove the owner.
  const db2 = await pair();
  await assert.rejects(call(db2, B, 'hh_remove_member', { p_user: A }), /not_owner/);
  assert.equal((await call(db2, A, 'hh_remove_member', { p_user: B })).removed, 1);
  await assert.rejects(call(db2, B, 'hh_pull', { p_since: 0 }), /not_member/);
});

test('pull pages by change number and the history shows who changed what', async () => {
  const db = await pair();
  const ops = Array.from({ length: 30 }, (_, i) => create('item-page-' + String(i).padStart(4, '0'), '商品' + i, i));
  await call(db, A, 'hh_push', { p_ops: ops });
  const p1 = await call(db, B, 'hh_pull', { p_since: 0, p_limit: 20 });
  assert.equal(p1.records.length, 20); assert.equal(p1.more, true);
  const p2 = await call(db, B, 'hh_pull', { p_since: p1.cursor, p_limit: 20 });
  assert.equal(p2.records.length, 10); assert.equal(p2.more, false);
  assert.equal((await call(db, B, 'hh_pull', { p_since: p2.cursor })).records.length, 0);
  await call(db, B, 'hh_push', { p_ops: [{ op_id: opId(), type: 'add', kind: 'item', id: 'item-page-0003', delta: -1 }] });
  const changes = await call(db, A, 'hh_changes', { p_limit: 5 });
  assert.equal(changes[0].who, 'パパ'); assert.equal(changes[0].name, '商品3'); assert.equal(Number(changes[0].delta), -1);
  const after = await call(db, A, 'hh_pull', { p_since: p2.cursor });
  assert.deepEqual(after.records.map(r => [r.id, Number(r.qty)]), [['item-page-0003', 2]]);
});
