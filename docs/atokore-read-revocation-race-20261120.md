# Family read vs membership removal: review-only concurrency test

Scope: Draft PR #106. Everything runs against disposable localhost PostgreSQL 17 database atokore_ci with synthetic users and records.

Baseline: hh_pull and hh_changes are STABLE and use my_household. A read started while an owner removal transaction is uncommitted may complete without waiting for the owner household lock.
Candidate: The review-only SQL changes exactly those two RPCs to VOLATILE and their member check to lock_member. The isolated test must observe a real PostgreSQL blocking wait; after the owner removal commits, the stale authenticated member request must fail with SQLSTATE 42501.

This is a conservative ordering improvement for security review, NOT evidence of an actual post-commit breach. Reads completed before owner commit may be acceptable under existing product semantics.
Changes to live Supabase, RLS, JWT, Storage, production/deployment and user data are explicitly out of scope. Candidate cannot be applied without separate owner approval, documented rollback, measured latency under contention and actual synthetic-user endpoint authorization testing.

Run using the existing receipt-revocation-audit GitHub Actions workflow, which verifies localhost-only database URL and runs both baseline and candidate SQL.
