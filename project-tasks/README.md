# Project Tasks — Sri Lakshmi Mangalya Malai (SLMM)

A project-wide, persistent task-management and handover system for **all** SLMM
work (development, testing, bug fixes, security audits, migrations, UI changes,
deployment preparation) — not just one task stream.

> **Environment policy: TEST-ONLY** (binding — `docs/project/PROJECT_STATUS.md` §8).
> Not connected to Lovable. Never target production.

## Layout

```
project-tasks/
  README.md                 <- this file
  _TEMPLATE/                <- copy this to start a new task (do not edit in place)
    TASK.md
    PROGRESS.md
    TEST_REPORT.md
    ARTIFACT_MANIFEST.md
  active/                   <- ACTIVE and BLOCKED tasks (current workstream)
  pending/                  <- PENDING tasks (agreed, not started)
  completed/                <- COMPLETED tasks (committed + pushed + verified)
```

Each task gets its **own** folder named `<TASK-ID>-<kebab-title>`, e.g.
`active/T6-group-l-concurrency-runner/`. Never reuse a previous task's folder.

## Task record files

| File | Purpose |
|---|---|
| `TASK.md` | ID, title, objective, scope, environment restrictions, acceptance criteria, git baseline, dependencies, risks. |
| `PROGRESS.md` | Steps completed, verification status, current blocker, exact next action, latest approved git checkpoint. |
| `TEST_REPORT.md` | Tests executed, PASS/FAIL/BLOCKED/NOT RUN, evidence and limitations, residue/rollback results. |
| `ARTIFACT_MANIFEST.md` | Source → destination filenames, SHA-256 checksums, committed git path/commit, status, retention note. |

## Lifecycle (non-negotiable)

1. New task → copy `_TEMPLATE/` into the right status folder; fill `TASK.md`.
2. Keep `PROGRESS.md` current after every meaningful step.
3. Record every test outcome in `TEST_REPORT.md` with its verification level.
4. After a function/task passes its required verification → **propose a focused commit**.
5. **Commit and GitHub push each require separate explicit user approval.**
6. Never mark a task COMPLETED merely because code was written or tests were planned.
7. Close a task **only** after its files are committed, pushed and verified on GitHub.
8. On closure: preserve permanent source, migrations, harnesses, evidence, checksums
   and essential history; review dependencies; archive the record into `completed/`.
9. Delete disposable working files **only** when explicitly identified, confirmed
   backed up or no longer needed, and **only** with separate approval.
10. Never silently overwrite a tested or committed artifact.

## Approval gates (non-negotiable)

**Read-only investigation is the default.** No change, execution, or external
action proceeds without its own explicit approval, and **approval for one
operation never authorizes the next**. Each of the following requires a
**separate, explicit** authorization:

1. **Editing verified or committed artifacts** (rule 10 — never silently overwrite).
2. **Git staging / commit.**
3. **GitHub push.**
4. **Database writes or schema changes** — TEST-only; requires the relevant
   live-guard opt-in / task confirm token.
5. **Deployments and production changes** — see `PROJECT_STATUS.md` §8 rules 6–7.
6. **Destructive cleanup or deletion** (lifecycle rule 9).

Invariants:

- A task is **not** `COMPLETED` until its required verification has passed
  **and** its GitHub backup is approved and confirmed.
- Each new task gets its **own** folder (never reuse a previous one) and its
  **own** checkpoint.
- Closed tasks retain durable evidence; disposable working files may be deleted
  **only** after separate approval.

## Status ↔ folder mapping

The index (`docs/project/TASK_INDEX.md`) uses four statuses but there are three
folders; `BLOCKED` tasks live in `active/` until unblocked or completed.

## Keep in sync

After any status change, update **both** the task folder and
`docs/project/TASK_INDEX.md`, and add an entry to
`docs/project/SESSION_HISTORY.md`.
