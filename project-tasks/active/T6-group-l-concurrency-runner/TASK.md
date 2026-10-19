# TASK — T6 Group-L concurrency runner (disposable local PostgreSQL 18 lab)

- **Task ID:** `T6`
- **Title:** Execute the corrected Group-L concurrency runner once against a disposable LOCAL PostgreSQL 18 lab.
- **Status:** `BLOCKED`
- **Owner / session:** SLMM local-lab session
- **Created:** `2026-10-19`
- **Environment restrictions:** LOCAL loopback PostgreSQL 18 only. Never connect to the existing PostgreSQL service on port 5432. Never connect to Supabase TEST or production. No production access. No Lovable.

## Objective

Run the corrected T6 Group-L concurrency runner **exactly once** against a
disposable, locally-owned PostgreSQL 18 cluster on `127.0.0.1:15432` (database
`t6lab`), executing the **12 Group-L concurrency cases**, then verify no residue
and shut the laboratory down.

This is a **local laboratory** task. It does **not** target Supabase TEST
(`nqadtfqyurkpmxcodswc`) or production.

## Scope

- In scope: local cluster provisioning (via `t6-runner.ps1`), the 12 Group-L
  concurrency cases, post-run residue check, teardown.
- Out of scope: any remote/Test/Production database, R2, Cloudflare, deployment,
  migrations applied anywhere other than the disposable lab.

## Acceptance criteria

- [ ] All six prerequisites pass before any cluster start.
- [ ] `t6-runner.ps1` SHA-256 == `fac7926d0de1739f89a9298baf1be0198268fb560ef80ddd151cb6b73720894c`.
- [ ] `t6-local-runner.mjs` SHA-256 == `e1719be2ac0d432c903035001fdb0774c93641c0fa308073eefcf55e699aa234`.
- [ ] Static negative tests: 20/20 Node, 15/15 PowerShell.
- [ ] Port `15432` has no listener; `%TEMP%\opencode\t6lab` absent or ownership certain.
- [ ] No PostgreSQL redirect env vars active.
- [ ] Runner executed exactly once: `powershell -File "$env:TEMP\opencode\t6-prep\t6-runner.ps1" -Confirm I_APPROVE_LOCAL_T6`.
- [ ] 12/12 Group-L cases reported; residue check clean; cluster stopped.

## Git baseline

- **HEAD at task start:** `eef9b2e607346f3560af5baf1f170932455a9b44`
- `origin/main` in sync; working tree **42 modified / 69 untracked** (preserve).
- The runner and prep files live in `%TEMP%\opencode\t6-prep` and are **not**
  tracked by Git.

## Dependencies

- Depends-on: corrected and re-hashed runner files; a quiescent local port 15432;
  an absent (or clearly-owned) disposable lab directory.
- Required approvals: explicit one-shot approval `-Confirm I_APPROVE_LOCAL_T6`
  (already granted once, 2026-10-19 — re-approval required for a new attempt).

## Risks

- Reusing a pre-existing lab directory could corrupt or leak state (blocker 3).
- A left-over listener on 15432 could mean the runner connects to the wrong cluster.
- Deleting `%TEMP%\opencode\t6lab` or killing PID 2676 destroys state without backup.

## Verification level

Local-lab verification only. A local pass does not prove any Supabase/remote
behavior.
