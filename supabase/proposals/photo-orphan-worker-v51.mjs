// DRAFT ONLY (v51, photo A): one pass of the trusted photo clean-up worker. Not deployed, not scheduled.
// `sql(fn, args)` calls a service-only function in atokore_private (service role, server side only);
// `storage.remove(bucket, path)` is the Storage API delete (never SQL). Both are injected, so the
// pass is tested against a real database and a fake Storage in isolation.
//
// Safety: every deletion is preceded by a database re-check under the photo locks (claim_purge refuses
// a referenced object; orphan_object_ok re-checks an unledgered one). A failure leaves the row where it
// was, so the next pass retries it; running the same pass twice changes nothing more (idempotent).
// Stuck uploads and stuck legacy moves are only reported: settlement is never inferred from time.
export const MANAGED_BUCKET = 'atokore-private-photos-v2';

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
        const removed = await storage.remove(MANAGED_BUCKET, path);
        if (!removed) { report.failed.push({ ...a, why: 'storage_remove_failed' }); continue; } // stays 'purging'
        if (await sql('photo_finish_purge_v50', [a.file_id, true])) report.purged.push(a.file_id);
        else report.failed.push({ ...a, why: 'still_present_after_remove' });
      } else if (a.action === 'orphan_object') {
        if (!(await sql('photo_orphan_object_ok_v51', [a.path]))) { report.kept.push({ ...a, why: 'now_ledgered_or_referenced' }); continue; }
        if (await storage.remove(MANAGED_BUCKET, a.path)) report.removedOrphans.push(a.path);
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

// One legacy reference -> managed ledger. `copy(legacyPath, targetPath)` copies through the Storage
// API and returns {bytes, legacySha, copySha} computed from the bytes actually read back.
export async function moveLegacyPhoto({ sql, storage, copy, household, record }) {
  const begun = await sql('photo_legacy_begin_v51', [household, record]);
  const c = await copy(begun.legacy_path, begun.target_path);
  const done = await sql('photo_legacy_commit_v51', [begun.file_id, c.bytes, c.legacySha, c.copySha]);
  if (done.status !== 'switched') return { status: done.status, file_id: begun.file_id };
  // The record now points at the managed copy; the legacy object is removed only after that.
  const removed = await storage.remove('atokore-product-photos', begun.legacy_path);
  const finished = removed ? await sql('photo_legacy_finish_v51', [begun.file_id, true]) : false;
  return { status: finished ? 'done' : 'switched', file_id: begun.file_id, path: done.path };
}
