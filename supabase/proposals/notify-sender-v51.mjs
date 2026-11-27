// DRAFT ONLY (v51, unit C): the trusted notice sender. Not deployed, not scheduled, and it cannot send a
// real notice: it refuses every provider that is not a synthetic test adapter. A real provider needs a
// separate review of its delivery and idempotency guarantees (official documentation) and owner approval.
//
// `sql(fn, args)` calls a service-only function in atokore_private. `provider` is
//   { synthetic: true, idempotent: boolean, send({ key, recipient, kind }) -> { status: 'delivered' | 'rejected' } }
// where `idempotent: true` means the provider itself de-duplicates sends with the same key.
//
// Per notice: reserve (lease) -> authorize (committed) -> in ONE transaction: fence (locks the recipient's
// membership) -> send with the notice id as the key -> report the outcome -> commit. A thrown error or an unknown answer is ambiguous: an idempotent provider
// retries later with the SAME key; any other provider holds the notice for review and never resends.
// A notice whose earlier attempt may have delivered (in_doubt) is never sent again by a non-idempotent provider.
//
// Work 8th (C): a stalled provider must not hold the recipient's membership lock (and so a leave) for
// ever. Three independent bounds, none of which needs the provider to cooperate:
//   1) the sender gives the provider an absolute deadline (sendDeadlineMs, 5 s) and stops waiting at it
//      (an answer after that is ignored and the notice is recorded as ambiguous / retry-with-same-key),
//   2) the database ends the sender's transaction itself: notify_fence_v51 sets lock / statement /
//      idle-in-transaction timeouts (8 s), so even a sender process that hangs inside the transaction loses
//      its connection and its locks -> the leave completes (within ~10 s),
//   3) the fence refuses a lease that would run out during the send (lease_short).
// Ending the wait does not recall a notice: a provider that might still accept it after the deadline
// ("late acceptance") could deliver to someone who has just left. Such providers are refused (delivery
// OFF): a provider must declare lateAcceptance: 'impossible' (after the deadline it never delivers).
export const SEND_DEADLINE_MS = 5000;
export function providerVerified(p) {
  return !!p && p.synthetic === true && typeof p.idempotent === 'boolean' && typeof p.send === 'function'
    && p.lateAcceptance === 'impossible';
}
// The provider's answer or null at the deadline, whatever the provider does (never resolves, ignores the
// abort signal, throws, or answers late).
async function sendWithin(provider, message, ms) {
  const abort = new AbortController();
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => { abort.abort(); resolve(null); }, ms); });
  try {
    return await Promise.race([Promise.resolve().then(() => provider.send({ ...message, signal: abort.signal })).catch(() => null), deadline]);
  } finally { clearTimeout(timer); }
}
export async function runNotifySender({ sql, tx, provider, limit = 20, leaseSeconds = 120, sendDeadlineMs = SEND_DEADLINE_MS }) {
  if (!providerVerified(provider)) return { status: 'refused', why: 'provider_not_verified' };
  if (!Number.isFinite(sendDeadlineMs) || sendDeadlineMs <= 0 || sendDeadlineMs > SEND_DEADLINE_MS) return { status: 'refused', why: 'deadline_invalid' };
  // Work 7th: the fence, the provider call and the outcome run in ONE transaction (see notify_fence_v51);
  // without one, the leave/accept order cannot be guaranteed, so nothing is sent.
  if (typeof tx !== 'function') return { status: 'refused', why: 'no_transaction' };
  const out = { status: 'ran', sent: [], retry: [], held: [], skipped: [] };
  const claims = await sql('notify_claim_v51', [limit, leaseSeconds]);
  for (const c of Array.isArray(claims) ? claims : []) {
    if (c.in_doubt && provider.idempotent !== true) {
      await sql('notify_complete_v51', [c.id, c.token, 'ambiguous']);
      out.held.push({ id: c.id, why: 'in_doubt' });
      continue;
    }
    const a = await sql('notify_authorize_v51', [c.id, c.token]);              // committed: a send may start
    if (a?.ok !== true) { out.skipped.push({ id: c.id, why: a?.why || 'not_authorized' }); continue; }
    // If the transaction itself fails (the database ended it at its timeout, the connection dropped, the
    // commit failed), nothing more is done here: authorize already committed send_started_at, so the
    // next claim is in doubt and a non-idempotent provider never sends it again.
    try { await tx(async t => {
      const f = await t('notify_fence_v51', [c.id, c.token]);                   // the linearization point
      if (f?.ok !== true) { out.skipped.push({ id: c.id, why: f?.why || 'fenced' }); return; }
      const answer = await sendWithin(provider, { key: f.idempotency_key, recipient: f.recipient, kind: f.kind }, sendDeadlineMs);
      const status = answer?.status;
      if (status === 'delivered') {
        const r = await t('notify_complete_v51', [c.id, c.token, 'sent']);
        (r === 'marked' || r === 'already_sent' ? out.sent : out.skipped).push({ id: c.id, why: r });
      } else if (status === 'rejected') {
        await t('notify_complete_v51', [c.id, c.token, 'failed']);
        out.retry.push({ id: c.id, why: 'rejected' });
      } else if (provider.idempotent === true) {
        await t('notify_complete_v51', [c.id, c.token, 'retry']);
        out.retry.push({ id: c.id, why: 'ambiguous_idempotent' });
      } else {
        await t('notify_complete_v51', [c.id, c.token, 'ambiguous']);
        out.held.push({ id: c.id, why: 'ambiguous' });
      }
    }); } catch { out.held.push({ id: c.id, why: 'transaction_lost' }); }
  }
  return out;
}
