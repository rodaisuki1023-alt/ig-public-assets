// Isolated check for applying (and withdrawing) 20261025090000_atokore_history_w2.sql, run in PGlite with the
// real migrations: the database is built without it, used, then the migration and the rollback are applied.
// It proves: no row changes, the same permissions, only the actor/record_id fields change, and the rollback
// restores the previous answer exactly. Real Supabase is not touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createDb, call } = require('./household/pg.cjs');

const MIGRATION = '20261025090000_atokore_history_w2.sql';
const migrationSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations', MIGRATION), 'utf8');
const rollbackSql = fs.readFileSync(path.join(__dirname, '../supabase/rollbacks/20261025090000_atokore_history_w2_rollback.sql'), 'utf8');
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', C = '00000000-0000-4000-8000-00000000000c';
let n = 1; const oid = () => `40000000-0000-4000-8000-${String(n++).padStart(12, '0')}`;
const pause = () => new Promise(r => setTimeout(r, 5));

async function seed(db) {
  await call(db, A, 'hh_create', { p_name: 'わが家', p_display_name: 'パパ' });
  let { code } = await call(db, A, 'hh_invite_create');
  await call(db, B, 'hh_join', { p_code: code, p_display_name: 'ママ' });
  await pause();
  await call(db, B, 'hh_push', { p_ops: [{ op_id: oid(), type: 'create', kind: 'item', id: 'item-diaper', fields: { name: 'おむつ M', unit: '袋' }, qty: 1, ts: Date.now() }] });
  await pause();
  await call(db, B, 'hh_leave');
  ({ code } = await call(db, A, 'hh_invite_create'));
  await call(db, B, 'hh_join', { p_code: code, p_display_name: 'おかあさん' });
  await pause();
  await call(db, B, 'hh_push', { p_ops: [{ op_id: oid(), type: 'add', kind: 'item', id: 'item-diaper', delta: 2 }] });
  await call(db, A, 'hh_push', { p_ops: [{ op_id: oid(), type: 'set', kind: 'item', id: 'item-diaper', field: 'place', value: '収納' }] });
  const hh = (await call(db, A, 'hh_my')).household.id;
  // An operation whose actor is not (or no longer) a known member.
  await db.query("insert into atokore_private.ops(household_id,op_id,actor,device,type,kind,record_id,body,result) values($1,'40000000-0000-4000-8000-0000000000ff','00000000-0000-4000-8000-0000000000ff',null,'delete','item','item-diaper','{}'::jsonb,'applied')", [hh]);
}
async function snapshot(db) {
  const out = {};
  for (const t of ['households', 'members', 'invites', 'records', 'ops']) {
    const { rows } = await db.query(`select * from atokore_private.${t} order by 1,2`);
    out[t] = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') + ':' + rows.length;
  }
  return out;
}
async function grants(db) {
  const { rows } = await db.query("select has_function_privilege('anon','public.hh_changes(int)','execute') anon, has_function_privilege('authenticated','public.hh_changes(int)','execute') auth, has_function_privilege('public','public.hh_changes(int)','execute') pub, (select prosecdef from pg_proc where oid='public.hh_changes(int)'::regprocedure) definer, (select proconfig from pg_proc where oid='public.hh_changes(int)'::regprocedure) config");
  return rows[0];
}
async function rejects(db, uid) { try { await call(db, uid, 'hh_changes'); return false; } catch (e) { return e.code || e.message; } }
const unchanged = row => { const { who, record_id, ...rest } = row; return rest; };
const byKey = rows => rows.map(r => r.type + '|' + r.at).sort().map(k => rows.find(r => r.type + '|' + r.at === k));

test('history migration: before → apply → rollback, on the same data', async () => {
  const db = await createDb({ skip: [MIGRATION] });
  await seed(db);
  const data0 = await snapshot(db), grants0 = await grants(db);
  const before = byKey(await call(db, A, 'hh_changes'));
  // Before (today's real database): latest name for everything, 家族 when unknown, no record_id.
  assert.deepEqual(before.map(r => [r.type, r.who, 'record_id' in r]), [['add', 'おかあさん', false], ['create', 'おかあさん', false], ['delete', '家族', false], ['set', 'パパ', false]]);

  await db.exec(migrationSql);
  const after = byKey(await call(db, A, 'hh_changes'));
  assert.deepEqual(after.map(r => [r.type, r.who, r.record_id]), [['add', 'おかあさん', 'item-diaper'], ['create', 'ママ', 'item-diaper'], ['delete', null, 'item-diaper'], ['set', 'パパ', 'item-diaper']]);
  assert.deepEqual(after.map(unchanged), before.map(unchanged), 'only who and record_id change');
  assert.deepEqual(await snapshot(db), data0, 'no row is changed by the migration');
  assert.deepEqual(await grants(db), grants0, 'same permissions and security settings');
  assert.equal((await grants(db)).anon, false);
  assert.equal((await grants(db)).auth, true);
  assert.ok(await rejects(db, null), 'signed-out callers are refused');
  assert.ok(await rejects(db, C), 'people outside the household are refused');
  // B (a member again) sees the same history as A.
  assert.deepEqual(byKey(await call(db, B, 'hh_changes')), after);

  await db.exec(rollbackSql);
  assert.deepEqual(byKey(await call(db, A, 'hh_changes')), before, 'the rollback restores the previous answer exactly');
  assert.deepEqual(await snapshot(db), data0, 'no row is changed by the rollback');
  assert.deepEqual(await grants(db), grants0);
  // Applying the migration again after a rollback works the same way.
  await db.exec(migrationSql);
  assert.deepEqual(byKey(await call(db, A, 'hh_changes')), after);
});

test('the rollback file restores the definition from 20261024111736_atokore_polish_v44.sql verbatim', () => {
  const polish = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261024111736_atokore_polish_v44.sql'), 'utf8');
  const i = polish.indexOf('create or replace function public.hh_changes'), j = polish.indexOf('end $$;', i) + 'end $$;'.length;
  assert.ok(i > 0 && rollbackSql.includes(polish.slice(i, j)));
  assert.match(rollbackSql, /revoke all on function public\.hh_changes\(int\) from public, anon;/);
  assert.match(rollbackSql, /grant execute on function public\.hh_changes\(int\) to authenticated;/);
  assert.doesNotMatch(rollbackSql, /\b(delete|update|insert|drop|truncate)\b/i);
  assert.doesNotMatch(migrationSql, /\b(delete|update|insert|drop|truncate)\b/i);
});
