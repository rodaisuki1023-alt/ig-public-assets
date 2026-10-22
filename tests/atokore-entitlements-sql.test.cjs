// Household plans and usage counting (preparation for a future subscription; nothing is sold).
// Runs the real migrations in PGlite. Covers: plans cannot be changed by members, usage counts once
// per event even when retried or sent at the same time, limits per plan, failed server reads given
// back only by the server, payment events applied once and in order, and that cancelling or
// expiring never deletes data or removes members.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, call, asRole } = require('./household/pg.cjs');

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';
const E = '00000000-0000-4000-8000-00000000000e';
let n = 0;
const key = () => `read-${String(++n).padStart(8, '0')}`;
async function household() {
  const db = await createDb();
  const hh = (await call(db, A, 'hh_create', { p_name: 'わが家', p_display_name: 'ママ' })).household.id;
  const { code } = await call(db, A, 'hh_invite_create');
  await call(db, B, 'hh_join', { p_code: code, p_display_name: 'パパ' });
  return { db, hh };
}
// The future payment webhook runs with the service role.
async function webhook(db, args) {
  const r = await db.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query(`select atokore_private.apply_contract_event($1, $2, $3, $4::uuid, $5, $6::timestamptz, $7::timestamptz, '{}'::jsonb) as r`,
      [args.provider || 'app_store', args.event, args.external || 'sub-1', args.hh, args.status, args.periodEnd, args.at])).rows[0].r;
  });
  return r;
}
const days = d => new Date(Date.now() + d * 86400000).toISOString();

test('a new household is free: 2 seats, 3 server reads a month; members see the same plan', async () => {
  const { db } = await household();
  for (const uid of [A, B]) {
    const e = await call(db, uid, 'hh_entitlements');
    assert.equal(e.plan, 'free');
    assert.deepEqual(e.limits, { seats: 2, server_receipt_reads: 3 });
    assert.equal(e.seats_used, 2);
    assert.equal(e.usage.server_receipt_reads, 0);
    assert.equal(e.premium_until, null);
  }
  await assert.rejects(call(db, A, 'hh_invite_create'), /seat_limit/);
  await assert.rejects(call(db, D, 'hh_entitlements'), /not_member/);
  await assert.rejects(call(db, null, 'hh_entitlements'), /permission denied/);
});

test('members cannot change the plan, the limits or the counts', async () => {
  const { db, hh } = await household();
  for (const sql of [
    `update atokore_private.households set plan = 'premium' where id = '${hh}'`,
    `delete from atokore_private.usage`,
    `insert into atokore_private.contracts values ('${hh}', 'manual', 'x', 'active', null, now(), now())`,
    `select atokore_private.apply_contract_event('manual', 'e1', 'x', '${hh}', 'active', null, now(), '{}')`,
    `select atokore_private.release('${hh}', 'server_receipt_reads', 'read-00000001', 'timeout')`,
    `select atokore_private.consume('${hh}', '${A}', 'server_receipt_reads', 'read-00000001')`,
  ]) await assert.rejects(asRole(db, A, sql), /permission denied/, sql);
  assert.equal((await call(db, A, 'hh_entitlements')).plan, 'free');
});

test('usage counts once per event: retries, double taps and simultaneous requests from two phones', async () => {
  const { db } = await household();
  const k = key();
  const first = await call(db, A, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: k });
  assert.deepEqual(first, { status: 'counted', used: 1, limit: 3 });
  // The same read retried (lost response, double tap, the other phone sending the same key).
  for (const uid of [A, A, B]) {
    assert.deepEqual(await call(db, uid, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: k }), { status: 'duplicate', counted: true, used: 1, limit: 3 });
  }
  // Two phones asking at the same moment for the last two units: exactly the limit is reached.
  const results = await Promise.all([A, B, A, B].map(uid => call(db, uid, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: key() })));
  assert.deepEqual(results.map(r => r.status).sort(), ['counted', 'counted', 'limit_reached', 'limit_reached']);
  assert.equal((await call(db, B, 'hh_entitlements')).usage.server_receipt_reads, 3);
  // Unknown features and malformed keys are refused without counting.
  assert.equal((await call(db, A, 'hh_consume', { p_feature: 'seats', p_event_key: key() })).status, 'rejected:unknown_feature');
  assert.equal((await call(db, A, 'hh_consume', { p_feature: 'unlimited', p_event_key: key() })).status, 'rejected:unknown_feature');
  assert.equal((await call(db, A, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: 'bad key!' })).status, 'rejected:bad_event_key');
});

test('a failed server read is given back by the server only, once, within an hour', async () => {
  const { db, hh } = await household();
  const k = key();
  await call(db, A, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: k });
  const release = (reason, eventKey = k) => db.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query('select atokore_private.release($1::uuid, $2, $3, $4) as r', [hh, 'server_receipt_reads', eventKey, reason])).rows[0].r;
  });
  assert.equal(await release('changed_my_mind'), 'rejected:bad_reason');
  assert.equal(await release('provider_error'), 'released');
  assert.equal(await release('provider_error'), 'not_found');
  assert.equal((await call(db, A, 'hh_entitlements')).usage.server_receipt_reads, 0);
  // Retrying the released read with the same key does not count it again; a new attempt is a new key.
  assert.deepEqual(await call(db, A, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: k }), { status: 'duplicate', counted: false, used: 0, limit: 3 });
  const old = key();
  await call(db, A, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: old });
  await db.query("update atokore_private.usage set at = now() - interval '2 hours' where event_key = $1", [old]);
  assert.equal(await release('timeout', old), 'not_found', 'a read that worked an hour ago cannot be given back later');
});

test('usage starts again each month (Japan time); earlier months are kept, not counted', async () => {
  const { db, hh } = await household();
  for (let i = 0; i < 3; i++) await call(db, A, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: key() });
  assert.equal((await call(db, A, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: key() })).status, 'limit_reached');
  await db.query("update atokore_private.usage set period = (period - interval '1 month')::date where household_id = $1", [hh]);
  assert.equal((await call(db, A, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: key() })).status, 'counted');
  assert.equal((await db.query('select count(*)::int as c from atokore_private.usage where household_id = $1', [hh])).rows[0].c, 4);
  const p = (await db.query("select atokore_private.usage_period('2026-10-31T15:30:00Z') as a, atokore_private.usage_period('2026-10-31T14:30:00Z') as b")).rows[0];
  assert.equal(new Date(p.a).getUTCMonth(), 10, '00:30 on Nov 1 in Japan is November');
  assert.equal(new Date(p.b).getUTCMonth(), 9);
});

test('premium: applied once from the payment event, more seats and reads for the whole household', async () => {
  const { db, hh } = await household();
  const at = new Date().toISOString();
  assert.equal(await webhook(db, { event: 'ev-1', hh, status: 'active', periodEnd: days(30), at }), 'applied');
  assert.equal(await webhook(db, { event: 'ev-1', hh, status: 'active', periodEnd: days(30), at }), 'duplicate');
  for (const uid of [A, B]) {
    const e = await call(db, uid, 'hh_entitlements');
    assert.equal(e.plan, 'premium');
    assert.deepEqual(e.limits, { seats: 6, server_receipt_reads: 30 });
  }
  const { code } = await call(db, B, 'hh_invite_create');
  await call(db, C, 'hh_join', { p_code: code, p_display_name: 'ばあば' });
  assert.equal((await call(db, C, 'hh_entitlements')).seats_used, 3);
  // An older event delivered late changes nothing.
  assert.equal(await webhook(db, { event: 'ev-0', hh, status: 'expired', periodEnd: null, at: new Date(Date.now() - 60000).toISOString() }), 'stale');
  assert.equal((await call(db, A, 'hh_entitlements')).plan, 'premium');
  // A second, different subscription for the same household is refused while one is active.
  assert.equal(await webhook(db, { event: 'ev-x', external: 'sub-2', hh, status: 'active', periodEnd: days(30), at: new Date(Date.now() + 1000).toISOString() }), 'rejected:other_active_contract');
  assert.equal((await db.query("select result from atokore_private.contract_events where event_id = 'ev-x'")).rows[0].result, 'rejected:other_active_contract');
});

test('cancel keeps the paid period; expiry falls back to free without deleting data or removing members', async () => {
  const { db, hh } = await household();
  await webhook(db, { event: 'ev-1', hh, status: 'active', periodEnd: days(30), at: new Date(Date.now() - 5000).toISOString() });
  const { code } = await call(db, A, 'hh_invite_create');
  await call(db, C, 'hh_join', { p_code: code, p_display_name: 'ばあば' });
  await call(db, C, 'hh_push', { p_ops: [{ op_id: '00000000-0000-4000-9000-000000000001', type: 'create', kind: 'item', id: 'item-milk-0001', fields: { name: '牛乳' }, qty: 2, ts: Date.now() }] });
  await call(db, A, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: key() });
  for (let i = 0; i < 4; i++) await call(db, A, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: key() });

  assert.equal(await webhook(db, { event: 'ev-2', hh, status: 'cancelled', periodEnd: days(10), at: new Date(Date.now() - 4000).toISOString() }), 'applied');
  assert.equal((await call(db, A, 'hh_entitlements')).plan, 'premium', 'paid days are kept after cancelling');

  assert.equal(await webhook(db, { event: 'ev-3', hh, status: 'expired', periodEnd: null, at: new Date(Date.now() - 3000).toISOString() }), 'applied');
  const e = await call(db, C, 'hh_entitlements');
  assert.equal(e.plan, 'free');
  assert.equal(e.seats_used, 3, 'nobody is removed');
  assert.equal(e.limits.seats, 2);
  assert.equal(e.usage.server_receipt_reads, 5, 'the record of use is kept');
  assert.equal((await call(db, A, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: key() })).status, 'limit_reached');
  // Everyone still reads and writes the shared stock.
  for (const uid of [A, B, C]) assert.equal((await call(db, uid, 'hh_pull', { p_since: 0 })).records[0].qty, 2);
  const push = await call(db, B, 'hh_push', { p_ops: [{ op_id: '00000000-0000-4000-9000-000000000002', type: 'add', kind: 'item', id: 'item-milk-0001', delta: 1, ts: Date.now() }] });
  assert.equal(push.results[0].status, 'applied');
  // Only new invites beyond the free seats are refused.
  await assert.rejects(call(db, A, 'hh_invite_create'), /seat_limit/);
  await call(db, C, 'hh_leave');
  await call(db, B, 'hh_leave');
  assert.ok((await call(db, A, 'hh_invite_create')).code, 'back within the free seats, inviting works again');
  // A plan that simply runs out (no event) also falls back.
  await webhook(db, { event: 'ev-4', hh, status: 'active', periodEnd: days(30), at: new Date(Date.now() - 2000).toISOString() });
  await db.query("update atokore_private.households set plan_expires_at = now() - interval '1 minute' where id = $1", [hh]);
  assert.equal((await call(db, A, 'hh_entitlements')).plan, 'free');
});

test('households cannot see or spend each other\'s usage', async () => {
  const { db } = await household();
  await call(db, E, 'hh_create', { p_name: '別の家', p_display_name: 'よそ' });
  const k = key();
  await call(db, A, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: k });
  // The same key in another household is a different event, counted there only.
  assert.equal((await call(db, E, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: k })).status, 'counted');
  assert.equal((await call(db, A, 'hh_entitlements')).usage.server_receipt_reads, 1);
  assert.equal((await call(db, E, 'hh_entitlements')).usage.server_receipt_reads, 1);
  await assert.rejects(call(db, D, 'hh_consume', { p_feature: 'server_receipt_reads', p_event_key: key() }), /not_member/);
});
