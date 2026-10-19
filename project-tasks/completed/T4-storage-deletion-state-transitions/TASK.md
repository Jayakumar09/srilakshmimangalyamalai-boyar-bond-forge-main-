# TASK — T4 Storage-deletion state transitions (live TEST verification)

- **Task ID:** `T4`
- **Title:** Verify the storage-deletion state transitions against TEST Supabase.
- **Status:** `COMPLETED`
- **Created:** `2026-10-18` (record created retrospectively 2026-10-19)
- **Environment restrictions:** TEST Supabase only (`nqadtfqyurkpmxcodswc`); rollback-only; never production.

## Objective

Confirm the installed storage-deletion **state-transition / fence** behavior
against TEST Supabase, live and rollback-only.

## Scope

- In scope: state transitions and reference-fence checks (C1–C61).
- Out of scope: production; real R2 object deletion; concurrency under true multi-worker contention.

## Acceptance criteria (met)

- [x] Live TEST execution, rollback-only, no persistent change.
- [x] `overall_verdict = PASS` with 61/61 cases.
- [x] Post-run residue PASS.
- [x] Harness scripts committed.

## Git baseline

- HEAD at execution: `1ba4351`; scripts preserved at `e54756b`. Both pushed (`origin/main`).

## Dependencies

- Depends-on: T3 claim-RPC contract; storage-deletion lifecycle migrations.

## Verification level

Live TEST (rollback-only). Does **not** prove R2 deletion or end-to-end Worker behavior.
