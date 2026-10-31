// Runs the real Supabase migrations in PGlite (Postgres compiled to WASM) for tests and the local
// emulator. Only the parts Supabase provides itself are stubbed: the anon/authenticated roles and
// auth.uid(), which reads the caller's id from the request settings exactly like Supabase does.
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const MIGRATIONS = path.resolve(__dirname, '../../supabase/migrations');
const PRELUDE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon,authenticated;
  grant select,insert,delete on storage.objects to authenticated;
`;
// Argument types of the client API, so JSON arguments are cast like PostgREST does.
const SIGNATURES = {
  hh_my: [], hh_create: [['p_name', 'text'], ['p_display_name', 'text']], hh_invite_create: [], hh_invite_revoke: [],
  hh_join: [['p_code', 'text'], ['p_display_name', 'text']], hh_leave: [], hh_remove_member: [['p_user', 'uuid']],
  hh_push: [['p_ops', 'jsonb'], ['p_device', 'text']], hh_pull: [['p_since', 'bigint'], ['p_limit', 'int']], hh_changes: [['p_limit', 'int']],
  hh_entitlements: [], hh_consume: [['p_feature', 'text'], ['p_event_key', 'text']],
  hh_undo_purchases: [['p_ops','jsonb']],
};

// skip: migration file names left out, to check a database as it is before a migration is applied.
async function createDb({ skip = [] } = {}) {
  const db = new PGlite();
  await db.exec(PRELUDE);
  for (const file of fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql') && !skip.includes(f)).sort()) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  }
  return db;
}

class RpcError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// Calls a public function as a signed-in user (or anonymously when uid is null), like PostgREST.
async function call(db, uid, fn, args = {}, claims = {}) {
  const sig = SIGNATURES[fn];
  if (!sig) throw new RpcError('unknown_function', '42883');
  const used = sig.filter(([name]) => args[name] !== undefined);
  const params = used.map(([name, type]) => (type === 'jsonb' ? JSON.stringify(args[name]) : args[name]));
  const sql = `select public.${fn}(${used.map(([name, type], i) => `${name} => $${i + 1}::${type}`).join(', ')}) as r`;
  try {
    return await db.transaction(async tx => {
      await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || '']);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({...claims,sub:uid||''})]);
      const res = await tx.query(sql, params);
      return res.rows[0].r;
    });
  } catch (e) {
    throw new RpcError(e.message, e.code);
  }
}

// Direct SQL as a client role, to prove tables cannot be reached without the functions.
async function asRole(db, uid, sql) {
  try {
    return await db.transaction(async tx => {
      await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || '']);
      return (await tx.query(sql)).rows;
    });
  } catch (e) {
    throw new RpcError(e.message, e.code);
  }
}

module.exports = { createDb, call, asRole, RpcError, SIGNATURES };
