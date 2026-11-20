# Family read vs membership removal: review-only concurrency test

Scope: Draft PR #106. Everything runs against disposable localhost PostgreSQL 17 database atokore_ci with synthetic users and records.

Baseline: hh_pull and hh_changes are STABLE and use my_household. A read started while an owner removal transaction is uncommitted may complete without waiting for the owner household lock.
Candidate: The review-only SQL changes exactly those two RPCs to VOLATILE and their member check to lock_member. The isolated test must observe a real PostgreSQL blocking wait; after the owner removal commits, the stale authenticated member request must fail with SQLSTATE 42501.

This is a conservative ordering improvement for security review, NOT evidence of an actual post-commit breach. Reads completed before owner commit may be acceptable under existing product semantics.
Changes to live Supabase, RLS, JWT, Storage, production/deployment and user data are explicitly out of scope. Candidate cannot be applied without separate owner approval, documented rollback, measured latency under contention and actual synthetic-user endpoint authorization testing.

Run using the existing receipt-revocation-audit GitHub Actions workflow, which verifies localhost-only database URL and runs both baseline and candidate SQL.

## 2026-11-20 follow-up: preserve parallel reads

The first candidate used `lock_member` which takes `FOR UPDATE`; **two ordinary concurrent household reads would serialize**, creating a potentially serious mobile sync latency problem. The revised **review-only** candidate adds `atokore_private.read_member` with `FOR SHARE` on the same household row, then rechecks current membership after the lock. This lock mode allows multiple authenticated readers simultaneously but conflicts with an owner-removal `FOR UPDATE`.

The isolated PostgreSQL CI must separately prove: (1) negative control: older exclusive candidate makes a second read block, (2) revised read-only candidate does **not** block a concurrent reader, (3) owner removal blocks on an outstanding reader and commits after it, (4) removed member's old session is denied afterward, and (5) read started during uncommitted removal blocks then is denied after commit. This is not yet applied to Supabase. Review the function's EXECUTE revocation, privilege model, performance and rollback before any actual migration.
