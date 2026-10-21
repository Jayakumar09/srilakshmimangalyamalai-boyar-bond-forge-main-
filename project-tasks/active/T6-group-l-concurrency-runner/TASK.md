# TASK — T6 Group-L concurrency runner (disposable local PostgreSQL 18 lab)

- **Task ID:** `T6`
- **Title:** Execute the corrected Group-L concurrency runner once against a disposable LOCAL PostgreSQL 18 lab.
- **Status:** `ACTIVE` — **Group-L local concurrency: VERIFIED PASS** (2026-10-21 10:06 IST). The **overall T6 program remains INCOMPLETE**: Supabase TEST/production behaviour is **NOT VERIFIED**, and Group-R, Group-C, R2 and scheduler integration remain separate pending gates. See "Scope of this PASS" below.
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

> **Objective MET (Group-L scope).** The C10 runner was executed **exactly
> once** on 2026-10-21 at approximately 10:06 IST against a disposable local
> PostgreSQL 18 laboratory and returned **PASS**: **12/12 Group-L cases PASS**.
> See "Execution status" below and "Scope of this PASS".

## Scope

- In scope: local cluster provisioning (via `t6-runner.ps1`), the 12 Group-L
  concurrency cases, post-run residue check, teardown.
- Out of scope: any remote/Test/Production database, R2, Cloudflare, deployment,
  migrations applied anywhere other than the disposable lab.

## Acceptance criteria

Each box below is ticked **only where the criterion is factually satisfied by
the 2026-10-21 10:06 IST execution**, with the verifying evidence named.

- [x] All six prerequisites pass before any cluster start. *(Verified in the
  launcher preflight: `port15432_listeners=0`, `t6lab_exists=False`, no
  `PG*`/`SUPABASE_*`/`R2_*` redirect variables, and the wrapper's own
  ownership/path/port guards all passed before `initdb`.)*
- [x] `t6-runner.ps1` SHA-256 == `fac7926d0de1739f89a9298baf1be0198268fb560ef80ddd151cb6b73720894c`. *(The **original recovered** wrapper is preserved unmodified at
  `test-harness/t6-checkpoint/t6-runner.ps1` and still hashes to this value. It
  was **not** the executed artifact — see the wording correction below.)*
- [x] `t6-local-runner.mjs` SHA-256 == `9f06b1c396e3634fc86eeab4d73878ce7345d7e7e5bffb0d1fea458d7f76b008`. *(Verified in the committed GitHub blob at
  `84d9e145`, in the preparation copy, and in the run's own
  `artifact-sha256` record.)*
- [x] Static negative tests: 20/20 Node, 15/15 PowerShell. *(The superseded
  counts were 20/20 Node and 15/15 PowerShell; the shipped C10 revision
  carries **35/35** Node self-tests and the approved v3 wrapper carries
  **196/196** PowerShell self-tests. Both exceed the criterion, and the
  17/17 C10 mutation tests were also killed.)*
- [x] Port `15432` has no listener; `%TEMP%\opencode\t6lab` absent or ownership certain. *(Pre-run: 0 listeners, lab directory absent. During teardown the
  laboratory was positively proven to be ours before it was stopped and
  deleted.)*
- [x] No PostgreSQL redirect env vars active. *(Verified before the run: no
  `PG*`, `POSTGRES*`, `SUPABASE_*`, `R2_*`, `AWS_*`, `SLMM_LIVE_TESTS` or
  scheduler variables were present.)*
- [x] Runner executed exactly once: `powershell -File "$env:TEMP\opencode\t6-prep\t6-runner.ps1" -Confirm I_APPROVE_LOCAL_T6`. *(**Wording corrected** to distinguish the
  artifacts: the **executed** command was
  `powershell -NoProfile -ExecutionPolicy Bypass -File "D:\DevProjects\Working\srilakshmimangalyamalai(boyar-bond-forge-main)\test-harness\t6-checkpoint\t6-runner-candidate-v3.ps1" -Confirm I_APPROVE_LOCAL_T6 -EvidenceRoot D:\SLMM-T6-EVIDENCE`
  — the approved **candidate v3** wrapper, SHA-256 `30e31c1d...97c`. The
  original recovered `t6-runner.ps1` was **never** copied to the preparation
  directory and was **never executed**; it remains a preserved artifact only.
  The C10 runner was executed **exactly once** — one launcher invocation, one
  child process, one candidate run.)*
- [x] 12/12 Group-L cases reported; residue check clean; cluster stopped. *(12/12 PASS, 0 FAIL, 0 BLOCKED, 0 NOT RUN; residue
  `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}`; the
  disposable cluster was stopped with ownership proven and the lab directory
  removed.)*

## Execution status (2026-10-21)

> **The C10 revision HAS now been executed against PostgreSQL and PASSED.**
> This supersedes the earlier statement that it had not. The earlier failed
> attempts remain recorded below as history and are **not** relabelled.

| Item | State |
|---|---|
| **C10 revision** `9f06b1c396e3634fc86eeab4d73878ce7345d7e7e5bffb0d1fea458d7f76b008` (71700 bytes / 1350 lines) | **EXECUTED ONCE on 2026-10-21 at approximately 10:06 IST** (launcher started 10:06:44, finished 10:07:07, elapsed 23.5 s, child pid 10228) against the disposable local lab. **Wrapper exit code `0`, verdict `PASS`.** All nine native steps exited 0: `initdb`, `pgctl_start`, `isready`, `identity`, `create_db`, `bootstrap`, `preflight`, `node`, `residue`. The verdict block records **zero** failure reasons. GitHub baseline at execution: `84d9e145e852dc9046ffa02c75bbee067aab508d`. |
| **Group-L case results** | **12 PASS, 0 FAIL, 0 BLOCKED, 0 NOT RUN** — T6-L01, T6-L02, T6-L03, T6-L04, T6-L05, T6-L06, T6-L07, **T6-L08a**, **T6-L08b**, T6-L09, T6-L10, T6-L11. All 12 ids are present exactly once, with no duplicates. Runner summary: `{"total":12,"pass":12,"fail":0,"blocked":0,"not_run":0,"harness_failed":false,"residue_failed":false}`. |
| **Results digest** | `3489610fbf2105868c8aa2ab6bd60681ac0788446a816980c5cbfd424b187b0c` — independently recalculated from the evidence copy and confirmed identical to the runner verdict (`runner_sha256`) and to the run's `artifact-sha256` manifest. |
| **Residue** | `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}` — zero synthetic rows, zero unexpected T6 backends, zero advisory locks. |
| **Disposable laboratory cleanup** | **Ownership-safe.** The teardown proved ownership before acting (`marker valid, postmaster.pid in our data dir, port 15432, postgres.exe naming our data dir`), stopped the cluster with `pg_ctl stop -m fast`, confirmed no live cluster of ours used the laboratory, and only then removed the lab tree. Post-run: `port15432_listeners=0`, `t6lab_exists=False`. The **port-5432 service was untouched** (`Running`, 2 listeners, 10 `postgres.exe`, pid 5148 — identical to the pre-run baseline). |
| **Evidence** | Run: `D:\SLMM-T6-EVIDENCE\t6-run-20261021-100645-9d2f02f9\` (run log, node log, results JSONL, verdict JSON, artifact checksums). Launcher: `D:\SLMM-T6-EVIDENCE\launcher-20261021-100642-9c43b8d4\` (stdout, stderr, exit code, timestamps, child pid, preflight/postrun state, process snapshot, launcher script). |
| **Earlier attempts (history - unchanged)** | The 2026-10-20 22:28 IST attempt (pre-C9 runner `e1719be2ac0d432c903035001fdb0774c93641c0fa308073eefcf55e699aa234`, 46751 bytes / 875 lines) and the 2026-10-21 09:01 IST attempt (C9 runner `0595bda3562d76056541106a33941638156340ce009a891c6746156922de8fc6`, 62766 bytes / 1203 lines) each returned **wrapper exit 1, verdict FAIL, T6-L01 = FAIL and the other eleven NOT RUN**, for two successive **harness** defects: first the per-case survivor check miscounting the runner's own reusable A/B sessions as leaks, then the audit observing its own observer as an unhealthy session. **Neither was a product RPC failure**, and neither outcome is relabelled. The 2026-10-19 and 2026-10-20 earlier attempts (parameter-binding failure, `$script:ExitCodes` never initialised, and the C2b pipe-inheritance deadlock) also remain recorded as history in `PROGRESS.md` and `TEST_REPORT.md`. |

## Scope of this PASS

This result is deliberately narrow. The following distinctions are load-bearing
and must not be collapsed:

| Scope | State |
|---|---|
| **Group-L local concurrency (12 cases, disposable local PostgreSQL 18 lab on `127.0.0.1:15432`)** | **VERIFIED PASS** — 12/12, zero residue, ownership-safe cleanup. |
| **Overall T6 program** | **INCOMPLETE.** The case matrix (`t6-case-matrix.json`) defines **23 cases** in three environments: 12 Group-L (local lab), **8 R-cases** and **3 C-cases**. Only the 12 Group-L cases have been executed. The matrix's own status field still reads `PLANNED - NOT EXECUTED` because it is the whole-matrix status, not a Group-L status. |
| **Supabase TEST / production behaviour** | **NOT VERIFIED.** The run targeted a local disposable lab only (`server_addr: 127.0.0.1`, `database: t6lab`, `port: 15432`). **No Supabase TEST or production database was contacted.** A local-lab pass does not prove any remote behaviour. |
| **Group-R (`T6-R01`–`T6-R08`)** | **Separate pending gate.** The matrix defines environment `R` as "TEST Supabase, two concurrent psql sessions, ZERO-COMMIT rollback-only". Not executed; requires its own approval and a TEST target. |
| **Group-C (`T6-C01`–`T6-C03`)** | **Separate pending gate.** The matrix defines environment `C` as "TEST Supabase, committed synthetic fixtures + explicit cleanup + residue proof - BLOCKED pending separate operator approval". Not executed; still BLOCKED. |
| **R2 / object-storage integration and scheduler integration** | **Separate pending gates.** No R2, Cloudflare or Worker operation was performed, and the scheduler was never activated (`SLMM_SCHEDULER_ENABLED` was not set). |
| **PostgreSQL defaults** | **Unchanged.** The lab still uses `initdb`/`pg_ctl` defaults; the only option string is `-p $Port -c listen_addresses=127.0.0.1 -c logging_collector=off`. No service configuration was modified. |

Full detail: `PROGRESS.md` (§8d for the 2026-10-21 09:01 attempt, §8e for the
C10 correction, §8f for the 2026-10-21 10:06 PASS), `ARTIFACT_MANIFEST.md`
(§1) and `TEST_REPORT.md` (rows Q, R and S). Durable evidence:
`D:\SLMM-T6-EVIDENCE\t6-run-20261021-100645-9d2f02f9\` and
`D:\SLMM-T6-EVIDENCE\launcher-20261021-100642-9c43b8d4\`.

**Note on the preparation copy:** `%TEMP%\opencode\t6-prep\t6-local-runner.mjs`
now holds the C10 revision `9f06b1c3...b008`, byte-identical to the committed
file, and the committed checksum manifest (`test-harness/t6-checkpoint/t6-checksums.txt`)
pins that same checksum.

## Git baseline

- **HEAD at task start:** `eef9b2e607346f3560af5baf1f170932455a9b44`
- `origin/main` in sync; working tree **42 modified / 69 untracked** (preserve).
- The runner and prep files live in `%TEMP%\opencode\t6-prep` and are **not**
  tracked by Git.
- **GitHub baseline at the successful execution:** `84d9e145e852dc9046ffa02c75bbee067aab508d`
  (the C10 runner, the reconciled checksum manifest, and the corrected task
  records). The earlier checkpoints remain valid history: `a7a647c` (T6 runner
  state and main-path coverage), `0d0bbe7` / `cd37ce4` (candidate v3 and its
  parameter-binding repair), `ed5e2121` (recovered checkpoint), `64dafc9`
  (task handover), `806d983` (handover system).

## Dependencies

- Depends-on: corrected and re-hashed runner files; a quiescent local port 15432;
  an absent (or clearly-owned) disposable lab directory.
- Required approvals: explicit one-shot approval `-Confirm I_APPROVE_LOCAL_T6`.
  This approval has now been granted **five** times (2026-10-19; three attempts
  on 2026-10-20; and 2026-10-21 at 09:01 and 10:06 IST). The **10:06 IST
  approval was consumed by the successful run**; the next execution — for
  Group-R, Group-C or any other gate — requires a **fresh, separate approval**.

## Risks

- Reusing a pre-existing lab directory could corrupt or leak state (blocker 3).
- A left-over listener on 15432 could mean the runner connects to the wrong cluster.
- Deleting `%TEMP%\opencode\t6lab` or killing PID 2676 destroys state without backup.

## Verification level

Local-lab verification only. A local pass does not prove any Supabase/remote
behavior.
