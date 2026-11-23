/**
 * Atokore photo gateway preflight contract (DRAFT, NOT WIRED OR DEPLOYED).
 *
 * This helper is deliberately incapable of reading a Storage URL. A future
 * protected backend MUST verify the actual Auth user, then check active
 * household membership and the item record on EVERY call, BEFORE touching
 * a service-secret Storage client. Merely importing this file never grants
 * access; a false/error result MUST be treated as a denial.
 */
export const PHOTO_MAX_BYTES = 81920;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RECORD = '[A-Za-z0-9_-]{8,64}';
const RE = new RegExp('^('+UUID+')/('+RECORD+')/('+UUID+')\\.jpg$');

export function parsePhotoPath(path) {
  if (typeof path !== 'string' || path.length > 180) return null;
  const match = RE.exec(path);
  if (!match) return null;
  return Object.freeze({ householdId: match[1], recordId: match[2], fileId: match[3] });
}

export function validJpegBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) return false;
  if (bytes.byteLength < 4 || bytes.byteLength > PHOTO_MAX_BYTES) return false;
  return bytes[0] === 0xff && bytes[1] === 0xd8 &&
    bytes[bytes.byteLength - 2] === 0xff && bytes[bytes.byteLength - 1] === 0xd9;
}

const deny = reason => Object.freeze({ allowed: false, reason });

/**
 * The two callbacks must be fresh, server-side checks:
 *  verifySession(token) -> { id: uuid } or null (not decoded JWT claims)
 *  checkCurrentAccess({userId,householdId,recordId,operation}) -> true ONLY
 *    if the current DB membership is active AND the item record exists.
 *
 * No caching, token claims-as-membership, or "fail open" retry is permitted.
 * This only checks authorization, not the network response/storage layer.
 */
export async function authorizePhotoOperation({
  operation, path, accessToken, verifySession, checkCurrentAccess,
  jpegBytes, contentType
} = {}) {
  if (operation !== 'read' && operation !== 'write' && operation !== 'delete')
    return deny('method');
  const parsed = parsePhotoPath(path);
  if (!parsed) return deny('path');
  if (typeof accessToken !== 'string' || !accessToken.trim() ||
      typeof verifySession !== 'function' || typeof checkCurrentAccess !== 'function')
    return deny('auth_unavailable');
  if (operation === 'write' && (
      contentType !== 'image/jpeg' || !validJpegBytes(jpegBytes)))
    return deny('jpeg_invalid');

  try {
    const user = await verifySession(accessToken);
    if (!user || typeof user.id !== 'string' ||
        !new RegExp('^'+UUID+'$').test(user.id)) return deny('auth');
    const nowAllowed = await checkCurrentAccess({
      userId: user.id, householdId: parsed.householdId,
      recordId: parsed.recordId, operation
    });
    if (nowAllowed !== true) return deny('membership');
    return Object.freeze({ allowed: true, ...parsed });
  } catch (_) {
    // Cannot reach Auth or membership DB? Never issue the Storage request.
    return deny('unavailable');
  }
}
