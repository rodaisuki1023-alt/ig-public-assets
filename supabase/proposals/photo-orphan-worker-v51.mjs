// DRAFT ONLY (v51, photo A): the trusted photo workers. Not deployed, not scheduled.
// `sql(fn, args)` calls a service-only function in atokore_private (service role, server side only).
// `storage` is the Storage API: download(bucket, path) -> Uint8Array, remove(bucket, path) -> boolean,
// copy(fromBucket, from, toBucket, to) -> {bytes, sourceSha, targetSha} hashed from the bytes read back.
// All are injected, so the workers are tested against a real database and a fake Storage in isolation.
//
// Work 7th (P0) — destructive steps need a guarantee the adapter itself declares and implements:
//   storage.capabilities.conditionalRemove === true and
//     storage.removeIfGeneration(bucket, path, gen) -> {status: 'deleted' | 'mismatch' | 'absent'}
//       deletes ONLY if the object still has generation `gen`, atomically; throws when the outcome is unknown.
//   storage.capabilities.authoritativeStat === true and
//     storage.stat(bucket, path) -> {exists: boolean, gen} answered with the service's authority over
//       that bucket and key; throws on 403 / 502 / timeout / anything unclear (never "absent" by guess).
// Without both (the real Supabase Storage remove API has no conditional delete, so the production
// adapter declares neither) the worker deletes NOTHING: it copies, backs up, verifies and holds
// ('destructive_disabled'). A decided delete is fenced in the database first (photo_delete_intents_v51),
// so no reservation or reference of that key can appear meanwhile.
//
// Safety:
//  * Only the two fixed buckets are ever touched, and only paths of the scoped form; the database
//    functions additionally refuse anything outside the synthetic trial households.
//  * A legacy photo is deleted only after the moved photo was READ the way the general gateway reads
//    it (readVerified: authorization, size, SHA-256, JPEG, re-check) and its bytes equal the legacy
//    bytes — on EVERY run, also when resuming a 'verified' move (Work 6th: a resume skipped the read and
//    deleted while the copy answered 502) — after a backup of the legacy bytes, and only after a locked
//    re-check (fresh read of the current object generation, legacy object unchanged since the copy,
//    legacy write paths closed, nothing else points at it). A failed read takes the move back.
//  * Every deletion of a managed object is preceded by a locked re-check (claim_purge refuses a
//    referenced object; orphan_object_ok re-checks an unledgered one).
//  * A failure leaves the state where it was, so the next run resumes from it; running a step twice
//    changes nothing more. Stuck uploads and stuck moves are only reported, never inferred from time.
import { readVerified } from './photo-general-v50.mjs';
export const MANAGED_BUCKET = 'atokore-private-photos-v2';
export const LEGACY_BUCKET = 'atokore-product-photos';
export const BACKUP_BUCKET = 'atokore-photo-backup-v51';
const SCOPED = /^[0-9a-f-]{36}\/[A-Za-z0-9_-]{8,64}\/[0-9a-f-]{36}\.jpg$/;
const scoped = p => typeof p === 'string' && SCOPED.test(p);
async function copy(storage, fromBucket, from, toBucket, to) {
  if (![MANAGED_BUCKET, LEGACY_BUCKET, BACKUP_BUCKET].includes(fromBucket) || ![MANAGED_BUCKET, BACKUP_BUCKET].includes(toBucket) || !scoped(from) || !scoped(to)) throw Error('refused: bucket or path out of scope');
  const c = await storage.copy(fromBucket, from, toBucket, to);
  return { bytes: c.bytes, sourceSha: c.sourceSha ?? c.legacySha, targetSha: c.targetSha ?? c.copySha };
}
export function destructiveAllowed(storage) {
  return storage?.capabilities?.conditionalRemove === true && typeof storage.removeIfGeneration === 'function'
    && storage?.capabilities?.authoritativeStat === true && typeof storage.stat === 'function';
}
// The outcome of one fenced delete: 'deleted' | 'absent' | 'kept' (confirmed) or 'unknown' (stays fenced).
async function removeFenced(storage, sql, bucket, path, gen) {
  if (![MANAGED_BUCKET, LEGACY_BUCKET].includes(bucket) || !scoped(path)) throw Error('refused: bucket or path out of scope');
  let outcome = 'unknown';
  try {
    const r = await storage.removeIfGeneration(bucket, path, gen ?? null);
    outcome = r?.status === 'deleted' ? 'deleted' : r?.status === 'absent' ? 'absent' : r?.status === 'mismatch' ? 'kept' : 'unknown';
  } catch { outcome = 'unknown'; }
  if (outcome === 'unknown') {
    // The answer was lost or unclear: only an authoritative look decides; an error decides nothing.
    try {
      const st = await storage.stat(bucket, path);
      if (st && st.exists === false) outcome = 'absent';
      else if (st && st.exists === true && st.gen !== (gen ?? null)) outcome = 'kept';
    } catch { outcome = 'unknown'; }
  }
  if (outcome === 'unknown') return 'unknown';
  await sql('photo_delete_resolved_v51', [bucket, path, outcome]);
  return outcome;
}

// Reads one attached photo exactly as the gateway would, and records the check (hash must match).
export async function checkRead({ sql, storage }, file) {
  const failed = async why => { await sql('photo_read_failed_v51', [file]).catch(() => null); return { ok: false, why }; };
  const target = await sql('photo_read_target_v51', [file]).catch(() => null);
  if (!target || !scoped(target.path) || typeof target.gen !== 'string') return failed('not_readable');
  let r;
  try { r = await readVerified({ read: () => sql('photo_read_target_v51', [file]), download: p => storage.download(MANAGED_BUCKET, p), path: target.path }); }
  catch { return failed('read_failed'); }
  if (!r.ok) return failed(r.error);
  // The generation seen before the read must still be there: a write in between is not this read.
  try { await sql('photo_read_checked_v51', [file, r.sha, r.bytes.length, target.gen]); } catch { return failed('read_mismatch'); }
  return { ok: true, sha: r.sha };
}

// One legacy reference -> managed ledger, resumed from wherever an earlier run stopped.
export async function moveLegacyPhoto({ sql, storage, household, record }) {
  const m = await sql('photo_legacy_begin_v51', [household, record]);
  let state = m.state;
  if (!scoped(m.legacy_path) || !scoped(m.target_path)) throw Error('refused: path out of scope');
  if (state === 'copying') {
    let c;
    try { c = await copy(storage, LEGACY_BUCKET, m.legacy_path, MANAGED_BUCKET, m.target_path); } catch (e) { if (/refused/.test(e.message)) throw e; return { status: 'copying', held: 'copy_failed', file_id: m.file_id }; }
    let done;
    try { done = await sql('photo_legacy_commit_v51', [m.file_id, c.bytes, c.sourceSha, c.targetSha]); }
    catch (e) { return { status: 'copying', held: /photo_copy_unverified/.test(e.message) ? 'copy_mismatch' : 'commit_failed', file_id: m.file_id }; }
    if (done.status !== 'switched') return { status: done.status, held: done.why, file_id: m.file_id };
    state = 'switched';
  }
  if (state === 'switched' || state === 'verified') {
    // Read again on every run (a resumed 'verified' move too): the legacy photo stays until the moved one
    // is proven readable with the same bytes right now.
    const r = await checkRead({ sql, storage }, m.file_id);
    if (!r.ok) return { status: 'switched', held: r.why, file_id: m.file_id };
    state = 'verified';
    // A backup of the legacy bytes before they can go (restore works without the legacy object).
    const backupPath = m.target_path;   // same scoped form, in the backup bucket
    let backupFailed = false;
    try {
      const b = await copy(storage, LEGACY_BUCKET, m.legacy_path, BACKUP_BUCKET, backupPath);
      if (b.sourceSha !== b.targetSha) return { status: 'verified', held: 'backup_mismatch', file_id: m.file_id };
      await sql('photo_legacy_backup_recorded_v51', [m.file_id, b.targetSha, b.bytes]);
    } catch (e) {
      // The legacy object may already be gone (an earlier run deleted it, or another product's move did).
      // That is fine only if this move's backup was recorded before: delete_ok refuses with no_backup otherwise.
      backupFailed = true;
    }
    // Nothing is deleted without the adapter's guarantee: verified and backed up, held here.
    if (!destructiveAllowed(storage)) return { status: 'verified', held: backupFailed ? 'backup_failed' : 'destructive_disabled', file_id: m.file_id };
    const ok = await sql('photo_legacy_delete_ok_v51', [m.file_id]);
    if (ok?.ok !== true) return { status: 'verified', held: ok?.why === 'no_backup' && backupFailed ? 'backup_failed' : (ok?.why || 'not_ok'), file_id: m.file_id };
    if (ok.bucket !== LEGACY_BUCKET || ok.path !== m.legacy_path) throw Error('refused: unexpected legacy target');
    const outcome = await removeFenced(storage, sql, LEGACY_BUCKET, ok.path, ok.gen);
    if (outcome === 'unknown') return { status: 'verified', held: 'delete_unconfirmed', file_id: m.file_id };
    if (outcome === 'kept') return { status: 'verified', held: 'legacy_changed', file_id: m.file_id };
    const finished = await sql('photo_legacy_finish_v51', [m.file_id, true]);
    return { status: finished ? 'done' : 'verified', file_id: m.file_id };
  }
  return { status: state, file_id: m.file_id };
}

// Restore one move (rehearsal / rollback). With the legacy object present the product points at it again;
// without it, the backup bytes are copied to a NEW managed id, committed, and read back like any photo.
export async function restoreLegacyPhoto({ sql, storage, file }) {
  let r = await sql('photo_legacy_restore_v51', [file]);
  if (r.status === 'verify_legacy') {
    // Back onto the legacy object: read it and prove the moved bytes first.
    if (!scoped(r.path)) throw Error('refused: path out of scope');
    let bytes;
    try { bytes = new Uint8Array(await storage.download(LEGACY_BUCKET, r.path)); } catch { return { status: 'restore_unread', held: 'legacy_read_failed', file_id: file }; }
    const sha = await sha256Hex(bytes);
    try { return await sql('photo_legacy_restore_legacy_v51', [file, sha, bytes.length, r.gen]); }
    catch { return { status: 'restore_unread', held: 'legacy_mismatch', file_id: file }; }
  }
  if (r.status === 'copy_backup') {
    if (!scoped(r.backup_path) || !scoped(r.target_path)) throw Error('refused: path out of scope');
    const c = await copy(storage, BACKUP_BUCKET, r.backup_path, MANAGED_BUCKET, r.target_path);
    if (c.sourceSha !== c.targetSha) return { status: 'copy_backup', held: 'copy_mismatch', file_id: r.file_id };
    const done = await sql('photo_legacy_restore_commit_v51', [file, r.file_id, c.bytes, c.targetSha]);
    r = { status: 'verify', file_id: done.file_id ?? r.file_id };
  }
  if (r.status === 'verify') {
    // restored only after a gateway-style read of the new id (every retry reads again).
    const read = await checkRead({ sql, storage }, r.file_id);
    if (!read.ok) return { status: 'restore_unread', held: read.why, file_id: r.file_id };
    try { return { ...(await sql('photo_legacy_restore_verified_v51', [file])), file_id: r.file_id }; }
    catch { return { status: 'restore_unread', held: 'restore_unverified', file_id: r.file_id }; }
  }
  return r;
}
async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
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
        if (!destructiveAllowed(storage)) { report.kept.push({ ...a, why: 'destructive_disabled' }); continue; }
        try { await sql('photo_claim_purge_v50', [a.file_id]); }
        catch (e) { report.kept.push({ ...a, why: /photo_still_referenced/.test(e.message) ? 'still_referenced' : 'claim_refused' }); continue; }
        const i = await sql('photo_purge_intent_v51', [a.file_id]);
        const outcome = await removeFenced(storage, sql, MANAGED_BUCKET, i.path, i.gen);
        if (outcome === 'unknown') { report.failed.push({ ...a, why: 'delete_unconfirmed' }); continue; }   // stays purging, fenced
        if (outcome === 'kept') { report.kept.push({ ...a, why: 'changed_since_decision' }); continue; }
        if (await sql('photo_finish_purge_v50', [a.file_id, true])) report.purged.push(a.file_id);
        else report.failed.push({ ...a, why: 'still_present_after_remove' });
      } else if (a.action === 'orphan_object') {
        if (!destructiveAllowed(storage)) { report.kept.push({ ...a, why: 'destructive_disabled' }); continue; }
        if (!(await sql('photo_orphan_object_ok_v51', [a.path, a.gen ?? null]))) { report.kept.push({ ...a, why: 'now_ledgered_referenced_or_changed' }); continue; }
        const outcome = await removeFenced(storage, sql, MANAGED_BUCKET, a.path, a.gen ?? null);
        if (outcome === 'deleted' || outcome === 'absent') report.removedOrphans.push(a.path);
        else if (outcome === 'kept') report.kept.push({ ...a, why: 'changed_since_decision' });
        else report.failed.push({ ...a, why: 'delete_unconfirmed' });
      } else {
        report.reported.push(a);
      }
    } catch (e) {
      report.failed.push({ ...a, why: String(e?.message || e).slice(0, 120) });
    }
  }
  return report;
}
