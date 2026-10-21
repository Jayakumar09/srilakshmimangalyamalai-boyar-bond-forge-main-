# TASK INDEX — Sri Lakshmi Mangalya Malai (SLMM)

> **Environment policy: TEST-ONLY** (binding). See `PROJECT_STATUS.md` §8.
> No production access. Not connected to Lovable.
>
> This is the authoritative list of every tracked task. It is **append-safe**:
> never delete a row — change its status. One row per task; details live in the
> task folder under `project-tasks/`.
>
> _Last updated: 2026-10-21 (T6 Group-L PASS + SQL harness recovery reconciled)._

## Status legend

| Status | Meaning | Folder |
|---|---|---|
| `ACTIVE` | Currently being worked; verification in progress. | `project-tasks/active/` |
| `BLOCKED` | Work started, cannot proceed until an explicit prerequisite/unblock occurs. | `project-tasks/active/` |
| `PENDING` | Agreed/queued, not yet started. | `project-tasks/pending/` |
| `COMPLETED` | Committed **and** pushed **and** verified on GitHub; record archived. | `project-tasks/completed/` |

> **Folder mapping decision (flag):** the approved structure lists three folders
> (`active/`, `pending/`, `completed/`) but four index statuses. `BLOCKED` tasks
> live in `active/` (still the current workstream) until unblocked or completed.
> If a dedicated `project-tasks/blocked/` folder is preferred, this is a one-line
> change.

> **Note:** tasks `T1` and `T2` are **not documented in the repository**; the
> earliest recorded task is `T3`. They are listed below as `UNKNOWN` rather than
> invented. Do not fabricate their content.

## Index

| ID | Title | Status | Folder | Latest evidence | Git checkpoint | Next action |
|---|---|---|---|---|---|---|
| INFRA-001 | Project-wide task management & handover system | COMPLETED | `docs/project/` + `project-tasks/` | this document | `806d983` (pushed, GitHub-verified 2026-10-19) | archived |
| T6 | Group-L concurrency runner — disposable local PG 18 lab | ACTIVE | `project-tasks/active/T6-group-l-concurrency-runner/` | **Group-L local concurrency VERIFIED PASS 12/12** (2026-10-21 10:06 IST, local lab only) | `61cc1a4` (PASS docs, pushed); runner/checksums `84d9e145`; baseline `11cbfdc9` | Group-R / Group-C / R2 / scheduler — each a separate pending gate; hosted Supabase TEST & production **NOT VERIFIED** |
| T5 | Storage-deletion lifecycle + fence — live TEST verification | COMPLETED | `project-tasks/completed/T5-storage-deletion-lifecycle-and-fence/` | `TEST_VERIFICATION_LEDGER.md` addendum 2026-10-19 | `b25555e`, `eef9b2e` (pushed) | archived |
| T4 | Storage-deletion state-transition — live TEST verification | COMPLETED | `project-tasks/completed/T4-storage-deletion-state-transitions/` | `TEST_VERIFICATION_LEDGER.md` addendum 2026-10-18 | `e54756b`, `1ba4351` (pushed) | archived |
| T3 | Storage-deletion claim RPC — live TEST verification | COMPLETED | `project-tasks/completed/T3-storage-deletion-claim-rpc/` | `TEST_VERIFICATION_LEDGER.md` addendum 2026-10-18 | `4f1be4f`, `ba239e5` (pushed) | archived |
| T2 | _(not documented in repository)_ | UNKNOWN | — | — | — | reconstruct if evidence found |
| T1 | _(not documented in repository)_ | UNKNOWN | — | — | — | reconstruct if evidence found |

## Open / pending summary (needs a human decision)

- **T6 — Group-L is VERIFIED PASS; the wider program is still open.** The
  corrected C10 Group-L runner was executed **exactly once** on 2026-10-21 at
  approximately 10:06 IST against a **disposable local PostgreSQL 18 lab** on
  `127.0.0.1:15432` (database `t6lab`): wrapper exit code `0`, verdict
  **PASS**, **12 PASS / 0 FAIL / 0 BLOCKED / 0 NOT RUN** across the full
  Group-L matrix (including both `T6-L08a` and `T6-L08b`), results digest
  `3489610fbf2105868c8aa2ab6bd60681ac0788446a816980c5cbfd424b187b0c`, zero
  residue (`synthetic_rows=0`, `other_t6_backends=0`, `t6_advisory_locks=0`),
  and an ownership-safe shutdown and laboratory deletion. The port-5432
  service was untouched and **no Supabase TEST or production database was
  contacted**.
  The remaining gates are **separate pending** and each needs its own approval
  and target: **Group-R** (`T6-R01`–`T6-R08`, TEST Supabase, ZERO-COMMIT
  rollback-only), **Group-C** (`T6-C01`–`T6-C03`, TEST Supabase, committed
  fixtures — still BLOCKED pending separate operator approval), and **R2 /
  object-storage and scheduler integration**. **Hosted Supabase TEST and
  production behaviour remain NOT VERIFIED** — a local-lab pass is not proof of
  remote behaviour.
- **SQL harness recovery — committed and published at `11cbfdc9`.** Six
  original SQL verification harnesses were recovered **byte-exact** and five
  pre-existing T3/T4 SQL harnesses were classified in `LIVE_SQL_HARNESSES`
  (all original registry entries preserved). The offline harness-safety suite
  passes **17/17**. **The recovered SQL has NOT been executed** — recovery is
  not a test result.
- **Aadhaar / Passport requirement conflict — OPEN / DEFERRED.** Indian
  residents require Aadhaar; residents abroad require Passport. **No
  implementation change has been approved.** See
  `docs/project/BUSINESS_RULE_REVIEW_AADHAAR_PASSPORT.md`.

## Completed-archive rule

A task moves to `project-tasks/completed/` **only** once its commit(s) are
pushed and verified on GitHub. Closing a task requires: review dependencies →
confirm backup of any disposable working files → archive the record → obtain
separate approval before deleting anything.

**T6 is not archived.** Its Group-L scope is verified and published, but the
wider T6 program is still open, so the record stays in
`project-tasks/active/`. The existing folder organization
(`active/` / `pending/` / `completed/`, with `BLOCKED` tasks living in
`active/`) is **unchanged**.
