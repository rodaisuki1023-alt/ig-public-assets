// DRAFT ONLY (v51, photo A): the trusted photo workers. Not deployed, not scheduled.
// `sql(fn, args)` calls a service-only function in atokore_private (service role, server side only).
// `storage` is the Storage API: download(bucket, path) -> Uint8Array, remove(bucket, path) -> boolean,
// and for a move `copy(legacyPath, targetPath)` copies and returns the hashes of the bytes read back.
// All are injected, so the workers are tested against a real database and a fake Storage in isolation.
//
// Safety:
//  * Only the two fixed buckets are ever touched, and only paths of the scoped form; the database
//    functions additionally refuse anything outside the synthetic trial households.
//  * A legacy photo is deleted only after the moved photo was READ the way the general gateway reads
//    it (readVerified: authorization, size, SHA-256, JPEG, re-check) and its bytes equal the legacy
//    bytes, and only after a locked re-check that nothing else still points at it.
//  * Every deletion of a managed object is preceded by a locked re-check (claim_purge refuses a
//    referenced object; orphan_object_ok re-checks an unledgered one).
//  * A failure leaves the state where it was, so the next run resumes from it; running a step twice
//    changes nothing more. Stuck uploads and stuck moves are only reported, never inferred from time.
import { readVerified } from './photo-general-v50.mjs';
export const MANAGED_BUCKET = 'atokore-private-photos-v2';
export const LEGACY_BUCKET = 'atokore-product-photos';
const SCOPED = /^[0-9a-f-]{36}\/[A-Za-z0-9_-]{8,64}\/[0-9a-f-]{36}\.jpg$/;
const scoped = p => typeof p === 'string' && SCOPED.test(p);
async function remove(storage, bucket, path) {
  if (![MANAGED_BUCKET, LEGACY_BUCKET].includes(bucket) || !scoped(path)) throw Error('refused: bucket or path out of scope');
  try { return (await storage.remove(bucket, path)) === true; } catch { return false; }
}

// Reads one attached photo exactly as the gateway would, and records the check (hash must match).
export async function checkRead({ sql, storage }, file) {
  const target = await sql('photo_read_target_v51', [file]).catch(() => null);
  if (!target || !scoped(target.path)) return { ok: false, why: 'not_readable' };
  let r;
  try { r = await readVerified({ read: () => sql('photo_read_target_v51', [file]), download: p => storage.download(MANAGED_BUCKET, p), path: target.path }); }
  catch { return { ok: false, why: 'read_failed' }; }
  if (!r.ok) return { ok: false, why: r.error };
  try { await sql('photo_read_checked_v51', [file, r.sha, r.bytes.length]); } catch { return { ok: false, why: 'read_mismatch' }; }
  return { ok: true, sha: r.sha };
}

// One legacy reference -> managed ledger, resumed from wherever an earlier run stopped.
export async function moveLegacyPhoto({ sql, storage, household, record }) {
  const m = await sql('photo_legacy_begin_v51', [household, record]);
  let state = m.state;
  if (state === 'copying') {
    if (!scoped(m.legacy_path) || !scoped(m.target_path)) throw Error('refused: path out of scope');
    let c;
    try { c = await storage.copy(m.legacy_path, m.target_path); } catch { return { status: 'copying', held: 'copy_failed', file_id: m.file_id }; }
    let done;
    try { done = await sql('photo_legacy_commit_v51', [m.file_id, c.bytes, c.legacySha, c.copySha]); }
    catch (e) { return { status: 'copying', held: /photo_copy_unverified/.test(e.message) ? 'copy_mismatch' : 'commit_failed', file_id: m.file_id }; }
    if (done.status !== 'switched') return { status: done.status, file_id: m.file_id };
    state = 'switched';
  }
  if (state === 'switched') {
    // The legacy photo stays until the moved one is proven readable with the same bytes.
    const r = await checkRead({ sql, storage }, m.file_id);
    if (!r.ok) return { status: 'switched', held: r.why, file_id: m.file_id };
    state = 'verified';
  }
  if (state === 'verified') {
    const ok = await sql('photo_legacy_delete_ok_v51', [m.file_id]);
    if (ok?.ok !== true) return { status: 'verified', held: ok?.why || 'not_ok', file_id: m.file_id };
    if (ok.bucket !== LEGACY_BUCKET || ok.path !== m.legacy_path) throw Error('refused: unexpected legacy target');
    if (!(await remove(storage, LEGACY_BUCKET, ok.path))) return { status: 'verified', held: 'remove_failed', file_id: m.file_id };
    const finished = await sql('photo_legacy_finish_v51', [m.file_id, true]);
    return { status: finished ? 'done' : 'verified', file_id: m.file_id };
  }
  return { status: state, file_id: m.file_id };
}

// Read checks for every attached photo of the trial households (required before closing legacy reads).
export async function runReadChecks({ sql, storage, limit = 50 }) {
  const due = await sql('photo_read_check_due_v51', [limit]);
  const out = { ok: [], failed: [] };
  for (const file of Array.isArray(due) ? due : []) {
    const r = await checkRead({ sql, storage }, file);
    (r.ok ? out.ok : out.failed).push(r.ok ? file : { file, why: r.why });
  }
  return out;
}

export async function runOrphanPass({ sql, storage, limit = 50 }) {
  const report = { retired: [], purged: [], removedOrphans: [], kept: [], failed: [], reported: [] };
  const actions = await sql('photo_orphans_v51', [limit]);
  for (const a of Array.isArray(actions) ? actions : []) {
    try {
      if (a.action === 'retire_expired') {
        if (await sql('photo_retire_expired_v50', [a.file_id])) report.retired.push(a.file_id);
        else report.kept.push({ ...a, why: 'not_expired_or_moved_on' });
      } else if (a.action === 'purge') {
        let path;
        try { path = await sql('photo_claim_purge_v50', [a.file_id]); }
        catch (e) { report.kept.push({ ...a, why: /photo_still_referenced/.test(e.message) ? 'still_referenced' : 'claim_refused' }); continue; }
        if (!(await remove(storage, MANAGED_BUCKET, path))) { report.failed.push({ ...a, why: 'storage_remove_failed' }); continue; } // stays 'purging'
        if (await sql('photo_finish_purge_v50', [a.file_id, true])) report.purged.push(a.file_id);
        else report.failed.push({ ...a, why: 'still_present_after_remove' });
      } else if (a.action === 'orphan_object') {
        if (!(await sql('photo_orphan_object_ok_v51', [a.path]))) { report.kept.push({ ...a, why: 'now_ledgered_or_referenced' }); continue; }
        if (await remove(storage, MANAGED_BUCKET, a.path)) report.removedOrphans.push(a.path);
        else report.failed.push({ ...a, why: 'storage_remove_failed' });
      } else {
        report.reported.push(a);
      }
    } catch (e) {
      report.failed.push({ ...a, why: String(e?.message || e).slice(0, 120) });
    }
  }
  return report;
}
