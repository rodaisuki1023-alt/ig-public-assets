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
export function providerVerified(p) {
  return !!p && p.synthetic === true && typeof p.idempotent === 'boolean' && typeof p.send === 'function';
}
export async function runNotifySender({ sql, tx, provider, limit = 20, leaseSeconds = 120 }) {
  if (!providerVerified(provider)) return { status: 'refused', why: 'provider_not_verified' };
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
    await tx(async t => {
      const f = await t('notify_fence_v51', [c.id, c.token]);                   // the linearization point
      if (f?.ok !== true) { out.skipped.push({ id: c.id, why: f?.why || 'fenced' }); return; }
      let answer;
      try { answer = await provider.send({ key: f.idempotency_key, recipient: f.recipient, kind: f.kind }); }
      catch { answer = null; }
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
    });
  }
  return out;
}
