# TASK — T3 Storage-deletion claim RPC (live TEST verification)

- **Task ID:** `T3`
- **Title:** Verify the storage-deletion claim RPCs against TEST Supabase.
- **Status:** `COMPLETED`
- **Created:** `2026-10-18` (record created retrospectively 2026-10-19)
- **Environment restrictions:** TEST Supabase only (`nqadtfqyurkpmxcodswc`); rollback-only; never production.

## Objective

Confirm the installed storage-deletion **claim** RPCs behave to contract against
TEST Supabase, offline-static + live rollback-only execution.

## Scope

- In scope: `claim_storage_deletion_request(uuid)` and `claim_storage_deletion_requests(integer)` authorization and behavior.
- Out of scope: production; R2 object operations; non-claim lifecycle stages (T4/T5).

## Acceptance criteria (met)

- [x] Live TEST execution, rollback-only, no persistent change.
- [x] `overall_verdict = PASS`.
- [x] Post-run residue PASS.
- [x] Harness scripts committed.

## Git baseline

- HEAD at execution: `ba239e5`; scripts preserved at `4f1be4f`. Both pushed (`origin/main`).

## Dependencies

- Depends-on: storage-deletion lifecycle migrations; committed harness.

## Verification level

Live TEST (rollback-only) + static contract. Does **not** prove R2 deletion or end-to-end Worker behavior.
