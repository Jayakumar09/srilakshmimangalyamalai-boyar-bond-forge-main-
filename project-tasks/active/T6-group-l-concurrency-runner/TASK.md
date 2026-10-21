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

> **Read "Execution status" below first.** The runner has been executed once
> already (2026-10-21), but the **currently approved C10 revision has not**.
> This objective still stands for that revision: it needs one fresh execution.

## Scope

- In scope: local cluster provisioning (via `t6-runner.ps1`), the 12 Group-L
  concurrency cases, post-run residue check, teardown.
- Out of scope: any remote/Test/Production database, R2, Cloudflare, deployment,
  migrations applied anywhere other than the disposable lab.

## Acceptance criteria

- [ ] All six prerequisites pass before any cluster start.
- [ ] `t6-runner.ps1` SHA-256 == `fac7926d0de1739f89a9298baf1be0198268fb560ef80ddd151cb6b73720894c`.
- [ ] `t6-local-runner.mjs` SHA-256 == `9f06b1c396e3634fc86eeab4d73878ce7345d7e7e5bffb0d1fea458d7f76b008`.
- [ ] Static negative tests: 20/20 Node, 15/15 PowerShell.
- [ ] Port `15432` has no listener; `%TEMP%\opencode\t6lab` absent or ownership certain.
- [ ] No PostgreSQL redirect env vars active.
- [ ] Runner executed exactly once: `powershell -File "$env:TEMP\opencode\t6-prep\t6-runner.ps1" -Confirm I_APPROVE_LOCAL_T6`.
- [ ] 12/12 Group-L cases reported; residue check clean; cluster stopped.

## Execution status (2026-10-21)

> **The runner HAS been executed** — but the **currently approved revision has
> NOT**. These two facts must not be conflated.

| Item | State |
|---|---|
| **C9 revision** `0595bda3562d76056541106a33941638156340ce009a891c6746156922de8fc6` (62766 bytes / 1203 lines) | **EXECUTED ONCE** on 2026-10-21 09:01 IST against the disposable local lab. Wrapper exit code **1**, verdict **FAIL**. Every bootstrap and preflight step passed; only the `node` step exited 1. |
| **C10 revision (current)** `9f06b1c396e3634fc86eeab4d73878ce7345d7e7e5bffb0d1fea458d7f76b008` (71700 bytes / 1350 lines) | **NOT EXECUTED** against PostgreSQL. Validated **offline only**: `node --check` 0 errors, **35/35** self-tests PASS, **17/17** mutants killed. It corrects the C9 run's observer self-classification defect. |
| **Historical result** (both 2026-10-21 executions) | **T6-L01 = FAIL; the other eleven Group-L cases = NOT RUN; 0 PASS.** The runner aborts the suite after the first non-PASS case. **No Group-L case has ever reported PASS** and **no product RPC failure has been demonstrated** — every assertion inside T6-L01 passed; the failures were harness defects (first the per-case survivor check, then the audit observing itself). |
| **Disposable laboratory** | Cleaned up with ownership proven before stopping on every attempt. Post-run: port 15432 free, `t6lab` absent, residue `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}`, and the port-5432 service untouched. |
| **Wrapper actually used** | The executions above used the approved **candidate v3** wrapper `test-harness/t6-checkpoint/t6-runner-candidate-v3.ps1` (SHA-256 `30e31c1d2c1f14f04bdff78cfd42fa466cb613efa923f099157a347a649ba97c`), invoked with `-Confirm I_APPROVE_LOCAL_T6 -EvidenceRoot D:\SLMM-T6-EVIDENCE`. The original recovered `t6-runner.ps1` (`fac7926d...`) remains the **approved but not-executable-as-is** artifact; its own acceptance criterion above is unchanged. |
| **Next step** | The C10 revision still needs a **fresh, separate one-shot execution approval** before it can be run. Until then T6 stays **BLOCKED** and the acceptance criteria above remain unticked. |

Full detail: `PROGRESS.md` (§8d for the 2026-10-21 execution, §8e for the C10
correction), `ARTIFACT_MANIFEST.md` (§1) and `TEST_REPORT.md` (rows Q and R).
Durable evidence: `D:\SLMM-T6-EVIDENCE\t6-run-20261021-090109-a3e53a67\` and
`D:\SLMM-T6-EVIDENCE\launcher-20261021-090107-6e3008ba\`.

**Note on the preparation copy:** `%TEMP%\opencode\t6-prep\t6-local-runner.mjs`
still holds the C9 revision `0595bda3...` and must be refreshed from the
committed C10 file before any further run. The committed checksum manifest
(`test-harness/t6-checkpoint/t6-checksums.txt`) now pins the C10 checksum.

## Git baseline

- **HEAD at task start:** `eef9b2e607346f3560af5baf1f170932455a9b44`
- `origin/main` in sync; working tree **42 modified / 69 untracked** (preserve).
- The runner and prep files live in `%TEMP%\opencode\t6-prep` and are **not**
  tracked by Git.

## Dependencies

- Depends-on: corrected and re-hashed runner files; a quiescent local port 15432;
  an absent (or clearly-owned) disposable lab directory.
- Required approvals: explicit one-shot approval `-Confirm I_APPROVE_LOCAL_T6`.
  This approval has now been granted **four** times (2026-10-19; three attempts
  on 2026-10-20; and 2026-10-21). **A fresh, separate approval is required for
  the next attempt** against the C10 revision.

## Risks

- Reusing a pre-existing lab directory could corrupt or leak state (blocker 3).
- A left-over listener on 15432 could mean the runner connects to the wrong cluster.
- Deleting `%TEMP%\opencode\t6lab` or killing PID 2676 destroys state without backup.

## Verification level

Local-lab verification only. A local pass does not prove any Supabase/remote
behavior.
