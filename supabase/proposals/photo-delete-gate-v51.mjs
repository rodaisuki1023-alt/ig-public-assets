// DRAFT ONLY (v51, Work 8th): the ONE gate for deleting photo objects. Every destructive step of the photo
// drafts (legacy move, orphan clean-up, purge of retired photos) goes through removeFenced; no other file
// may delete Storage objects (tests/atokore-photo-delete-paths-v51.test.cjs scans the repository).
//
// Deleting needs a guarantee the storage adapter itself declares and implements:
//   storage.capabilities.conditionalRemove === true and
//     storage.removeIfGeneration(bucket, path, gen) -> {status: 'deleted' | 'mismatch' | 'absent'}
//       deletes ONLY if the object still has generation `gen`, atomically; throws when the outcome is unknown,
//   storage.capabilities.authoritativeStat === true and
//     storage.stat(bucket, path) -> {exists, gen}, with the service's authority over that bucket and key;
//       throws on 403 / 502 / timeout / anything unclear (never "absent" by guess).
// The real Supabase Storage remove API has no conditional delete, so the production adapter declares
// neither: nothing is deleted. Before calling this, the database has fenced the key
// (photo_delete_intents_v51); an unclear outcome keeps it fenced and pending — never released by time.
export const MANAGED_BUCKET = 'atokore-private-photos-v2';
export const LEGACY_BUCKET = 'atokore-product-photos';
const SCOPED = /^[0-9a-f-]{36}\/[A-Za-z0-9_-]{8,64}\/[0-9a-f-]{36}\.jpg$/;
export function destructiveAllowed(storage) {
  return storage?.capabilities?.conditionalRemove === true && typeof storage.removeIfGeneration === 'function'
    && storage?.capabilities?.authoritativeStat === true && typeof storage.stat === 'function';
}
// The outcome of one fenced delete: 'deleted' | 'absent' | 'kept' (confirmed, recorded) or 'unknown'
// (stays pending and fenced). 'refused' when the adapter cannot guarantee it (nothing was called).
export async function removeFenced(storage, sql, bucket, path, gen) {
  if (![MANAGED_BUCKET, LEGACY_BUCKET].includes(bucket) || typeof path !== 'string' || !SCOPED.test(path)) throw Error('refused: bucket or path out of scope');
  if (!destructiveAllowed(storage)) return 'refused';
  let outcome = 'unknown';
  try {
    const r = await storage.removeIfGeneration(bucket, path, gen ?? null);
    outcome = r?.status === 'deleted' ? 'deleted' : r?.status === 'absent' ? 'absent' : r?.status === 'mismatch' ? 'kept' : 'unknown';
  } catch { outcome = 'unknown'; }
  if (outcome === 'unknown') {
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
