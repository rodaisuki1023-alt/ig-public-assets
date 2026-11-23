/**
 * Atokore v50 experimental private-photo READ adapter (NOT ROUTED / NOT DEPLOYED).
 *
 * The future server adapter must supply trusted live Auth and DB lookups and a
 * server-private Storage reader. Never expose the service key or direct object
 * URLs to a browser. This module is intentionally independent of SDKs and
 * network services so the refusal behavior can be tested without a live DB.
 *
 * HTTP integration MUST separately constrain origin/CORS, JSON/body length,
 * rate limits, server-secret provisioning and Content Security Policy. Current
 * v50 browser code still calls Storage directly and is NOT SAFE TO RELEASE.
 */
import { authorizePhotoOperation, validJpegBytes } from './photo-gateway-policy.mjs';

const NO_CACHE = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
});

function result(status, code, body) {
  return Object.freeze({
    status,
    headers: { ...NO_CACHE, ...(status === 200 ? { 'Content-Type': 'image/jpeg' } : {}) },
    ...(code ? { error: code } : {}),
    ...(body ? { body } : {}),
  });
}

function tokenFromHeader(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9._~+\/-]+={0,2})$/.exec(header);
  return match ? match[1] : null;
}

/**
 * Returns a mockable POST-only handler, not a runnable production endpoint.
 * The two live checks also guard against revocation WHILE Storage is reading.
 * No permanent URL, signed URL, client-controlled bucket or cache is emitted.
 */
export function createPhotoReadHandler({ verifySession, checkCurrentAccess, readObject } = {}) {
  if (typeof verifySession !== 'function' ||
      typeof checkCurrentAccess !== 'function' ||
      typeof readObject !== 'function') {
    throw new TypeError('server-side Auth, membership and Storage adapters are required');
  }
  return async function handle({ method, authorization, path } = {}) {
    if (method !== 'POST') return result(405, 'method');
    const accessToken = tokenFromHeader(authorization);
    if (!accessToken) return result(401, 'auth');
    const args = {
      operation: 'read', path, accessToken, verifySession, checkCurrentAccess,
    };
    const before = await authorizePhotoOperation(args);
    if (!before.allowed) return result(before.reason === 'path' ? 400 : before.reason === 'unavailable' ? 503 : 403, 'denied');
    let bytes;
    try {
      bytes = await readObject({
        householdId: before.householdId,
        recordId: before.recordId,
        fileId: before.fileId,
      });
    } catch (_) {
      return result(503, 'unavailable');
    }
    if (!validJpegBytes(bytes)) return result(502, 'invalid_photo');

    // Membership may be revoked while the object is being read. Re-check
    // immediately before giving the bytes to the HTTP response writer.
    const after = await authorizePhotoOperation(args);
    if (!after.allowed || after.householdId !== before.householdId ||
        after.recordId !== before.recordId || after.fileId !== before.fileId) {
      return result(after.reason === 'unavailable' ? 503 : 403, 'denied');
    }
    return result(200, null, bytes);
  };
}
