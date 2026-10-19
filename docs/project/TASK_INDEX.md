# TASK INDEX — Sri Lakshmi Mangalya Malai (SLMM)

> **Environment policy: TEST-ONLY** (binding). See `PROJECT_STATUS.md` §8.
> No production access. Not connected to Lovable.
>
> This is the authoritative list of every tracked task. It is **append-safe**:
> never delete a row — change its status. One row per task; details live in the
> task folder under `project-tasks/`.
>
> _Last updated: 2026-10-19 (task-management system bootstrap)._

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
| INFRA-001 | Project-wide task management & handover system | ACTIVE | `docs/project/` + `project-tasks/` | this document | uncommitted | review → approve commit (then push) |
| T6 | Group-L concurrency runner — disposable local PG 18 lab | BLOCKED | `project-tasks/active/T6-group-l-concurrency-runner/` | re-verified 2026-10-19 | none (never executed) | resolve 3 prereq failures (see task) |
| T5 | Storage-deletion lifecycle + fence — live TEST verification | COMPLETED | `project-tasks/completed/T5-storage-deletion-lifecycle-and-fence/` | `TEST_VERIFICATION_LEDGER.md` addendum 2026-10-19 | `b25555e`, `eef9b2e` (pushed) | archived |
| T4 | Storage-deletion state-transition — live TEST verification | COMPLETED | `project-tasks/completed/T4-storage-deletion-state-transitions/` | `TEST_VERIFICATION_LEDGER.md` addendum 2026-10-18 | `e54756b`, `1ba4351` (pushed) | archived |
| T3 | Storage-deletion claim RPC — live TEST verification | COMPLETED | `project-tasks/completed/T3-storage-deletion-claim-rpc/` | `TEST_VERIFICATION_LEDGER.md` addendum 2026-10-18 | `4f1be4f`, `ba239e5` (pushed) | archived |
| T2 | _(not documented in repository)_ | UNKNOWN | — | — | — | reconstruct if evidence found |
| T1 | _(not documented in repository)_ | UNKNOWN | — | — | — | reconstruct if evidence found |

## Blocked summary (needs a human decision)

- **T6** — three prerequisites still fail (see folder). No cluster was started.
  The approved local PostgreSQL service on `127.0.0.1:15432` (PID 2676) and the
  pre-existing `%TEMP%\opencode\t6lab` directory are **left untouched** pending
  an explicit decision.

## Completed-archive rule

A task moves to `project-tasks/completed/` **only** once its commit(s) are
pushed and verified on GitHub. Closing a task requires: review dependencies →
confirm backup of any disposable working files → archive the record → obtain
separate approval before deleting anything.
