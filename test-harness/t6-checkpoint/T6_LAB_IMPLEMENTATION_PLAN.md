# T6 LOCAL CONCURRENCY LAB — IMPLEMENTATION PLAN & STATIC SAFETY REVIEW

**Status:** IMPLEMENTED + STATICALLY VALIDATED. **NOT EXECUTED.** No database connection of any kind was made in this phase.
**Checkpoint:** `eef9b2e607346f3560af5baf1f170932455a9b44` · **Repository files:** untouched (0 added, 0 modified by this task).
**Scope:** Group L only — 12 matrix cases (`T6-L01` … `T6-L11`, with `L08a`/`L08b`).
**Accepted inputs (SHA-256 verified this phase):**
`t6-case-matrix.json` = `db689dc37b67d1a49bb1c62f0db5e7dc4c43bdea86e476a8be9037ae540a3a69`;
`T6_PREPARATION_PLAN.md` = `d24810f9b0947d74ee35544cf18fe468adb8bef202676b938309b1c265e22a3b`;
`T6_LAB_DESIGN.md` = `057ea3fa8e73132061efacb90e2d7c6660d2a8326933d8a572eb5f757a5d7add`;
`slmm-storage-deletion-t6-residue.sql` = `66edf661e1d70a935eee793ed0d24e0b245d5af78dc8d36fb81200cf534cd92e`.

## 1. Deliverables (all under `%TEMP%\opencode\t6-prep`, none in the repository)
| File | Role |
|---|---|
| `t6-local-runner.mjs` | The Group-L runner: 12 cases, 4 connections (A, B, read-only observer, setup), state-based sync, assertions, JSONL results + SHA-256. |
| `t6-runner.ps1` | Orchestrator: safety guards, disposable `initdb`/`pg_ctl` on port 15432, bootstrap, preflight, run, residue, guaranteed shutdown, hashes. |
| `t6-lab-setup.sql` | Bootstrap: loads the lab schema and migrations `20261017120000`–`20261017150000` verbatim; post-condition checks 12 functions + 6 fence triggers. |
| `t6-preflight-lab.sql` | Read-only fail-closed preflight: target identity, migration fidelity, namespace purity, no stray T6 backends. |
| `t6-lab-residue.sql` | Read-only residue: 10 relations zero, no A/B sessions, no T6 advisory locks. |
| `t6-sync.sql` | Reference of the observation queries used for synchronization. |

## 2. Connection / isolation model
- Four independent `psql` processes, each with a distinct `application_name`: `slmm-t6-a`, `slmm-t6-b`, `slmm-t6-obs` (read-only), `slmm-t6-setup`.
- **The setup connection is the only committer.** It creates the committed synthetic fixtures and performs the committed-holder release in `T6-L01`. The concurrent test sessions **A/B never issue `COMMIT`** (static check: 0 `COMMIT` statements on the A/B sessions; the single `COMMIT` in the runner is `setup.exec("COMMIT;")`, commented as the committed-holder release).
- Every case runs on loopback port **15432**; preflight re-proves `port=15432`, `data_directory` under `opencode/t6lab`, `database=t6lab`, `listen_addresses=127.0.0.1`, default isolation `read committed`.
- Guards refuse: port 5432, non-loopback host, database name containing `prod`/`supabase`, database ≠ `t6lab`, ambient `SUPABASE_*`/`R2_*`/`SLMM_LIVE_TESTS`, scheduler flag, lab root not under `t6lab`, and a missing `T6_LAB_CONFIRM=I_APPROVE_LOCAL_T6`.

## 3. Deterministic, observable synchronization
Ordering evidence is **not** a sleep. The observer polls `pg_locks` / `pg_stat_activity` through a separate connection until an observed condition holds (bounded 9 s, well under `lock_timeout`), then the driver acts. Row-lock facts are observed as:
- **holder** → granted `locktype='transactionid'` lock for the holder's pid;
- **waiter** → any ungranted lock entry for the waiter's pid;
- **advisory holder/waiter** → granted / ungranted `locktype='advisory'`;
- **session alive** → `pg_stat_activity` row for the pid.
The polling interval (40 ms) is observation cadence only. The per-key advisory key is never computed client-side; the lock is observed, never inferred.

### Release protocol (and why L01 is not "barrier then simultaneous")
Under the no-COMMIT constraint on A/B, a *simultaneous* loser of a single-row claim cannot return 0 rows: it blocks on the holder's row lock until the holder's transaction ends, and then either sees the committed claim (0 rows) or the unchanged row (1 row) depending on the release. The accepted design already specifies both release semantics, so the runner implements them with an observed waiter:
- **commit release** (`T6-L01` part a): the setup connection holds an uncommitted claim; A blocks (observed); setup `COMMIT`; A returns **0 rows** → exactly one winner.
- **rollback release** (`T6-L01` part b, `T6-L02`): a session holds the claim; B blocks (observed); holder `ROLLBACK`; B wins → exactly one persisted winner, `attempt_count` advanced exactly once.
`T6-L11` remains genuinely concurrent: both sessions hold their own advisory lock, then each requests the other's.

## 4. Case-by-case implementation status
| ID | Status | Protocol (observed wait) | Expected outcome / SQLSTATE | Final row-state assertion |
|---|---|---|---|---|
| T6-L01 | implemented | committed holder (setup) + observed blocked claim, then commit/rollback release | commit release: loser 0 rows; rollback release: waiter 1 row | commit: `attempt_count=1` exactly once; rollback: fixture unchanged (`attempt_count=0`) |
| T6-L02 | implemented | expired lease (`now()-10min`, attempt 2) held by A; B observed waiting; A rollback | no `55P03`; waiter reclaims | waiter `attempt_count=3` (never 4); token rotated; fixture back to 2 |
| T6-L03 | implemented | stale fabricated token against a committed lease | returns `false` | full-row snapshot byte-identical before/after |
| T6-L04 | implemented | (a) wrong token + valid lease; (b) correct token + expired lease | both return `false` | row snapshot byte-identical in both sub-cases |
| T6-L05 | implemented | 6 pending; A claims 3 (observed open write txn); B claims 6 | B does not wait (`< 3000 ms`) | disjoint id sets; union = 6; no duplicate |
| T6-L06 | implemented | A holds one row `FOR UPDATE` (observed); B claims 10 | B excludes the held row, no wait | after A ROLLBACK the held row is claimable |
| T6-L07 | implemented | 2 blocked @30 min, 1 blocked @2 h; A claims, B claims | 30-min rows never eligible | the 2-h row claimed exactly once; B = 0 rows |
| T6-L08a | implemented | committed live request; B calls `request_storage_deletion` | returns the existing id | exactly one live row; no duplicate |
| T6-L08b | implemented | A holds the per-key advisory lock; B observed waiting; A rollback | B creates its own request | zero committed rows after both `ROLLBACK` |
| T6-L09 | implemented | committed expired lease; A claims then terminated (`pg_terminate_backend`, recorded) | refresh; B reclaims | B `attempt_count=2`; token ≠ old; no stuck lock |
| T6-L10 | implemented | A claims in-txn then terminated | B claims afterwards | row byte-identical after termination; B `attempt_count=1` |
| T6-L11 | implemented | both hold one advisory lock, then request the other's (`lock_timeout=2s`, `deadlock_timeout=5s`) | ≥1 × `55P03`, **0 × `40P01`** | both `ROLLBACK`; no advisory lock remains |

## 5. Timeouts, deadlocks, failure semantics
- `lock_timeout=10s` (2 s in `T6-L11`), `statement_timeout=30s`, `idle_in_transaction_session_timeout=60s`, `ON_ERROR_STOP=1` on every session.
- `T6-L11` sets `deadlock_timeout=5s` **above** `lock_timeout=2s`, so lock contention resolves as a bounded `55P03` before the deadlock detector can fire. The runner asserts `0 × 40P01`; this verifies that the production single-lock paths cannot self-deadlock and that contention is bounded rather than indefinite.
- Sync polling is bounded at 9 s (< `lock_timeout`), so a missed observation surfaces as **BLOCKED** (`SYNC_TIMEOUT`), never as a spurious `55P03`.
- Fail closed: a `SYNC_TIMEOUT` or a lost connection marks the case `BLOCKED`; an unexpected error marks it `FAIL`; either **aborts** the suite (remaining cases are recorded `NOT_RUN`, never `PASS`). The process exits non-zero unless every case is `PASS`.

## 6. Cleanup & recovery safeguards
1. Every case begins from a clean autocommit state and every exit path issues `ROLLBACK` on A, B **and** setup.
2. Committed fixtures are registered per case and deleted in that case's cleanup via the setup connection.
3. Surviving A/B backends detected after a case are force-terminated through the observer and the case is marked `FAIL`.
4. Before residue, A and B are closed by `pg_terminate`/child termination and the runner waits until their backends are gone.
5. Independent read-only residue (`t6-lab-residue.sql`): ten relations zero, no A/B sessions, **no T6 advisory locks**. Non-zero ⇒ `RAISE` ⇒ psql exit 3 ⇒ run fails.
6. Full teardown: every case ends with ROLLBACK; the runner kills all children; the wrapper stops the cluster (`-m fast`, then `-m immediate` fallback) in a `finally` block and removes the temp cluster tree.
7. Healing-resistance: `pg_terminate_backend` is used only in `T6-L09`/`T6-L10`, always recorded; the runner never relies on it unless the case requires it.

## 7. Offline validation performed (no DB started, no connection made)
- `node --check t6-local-runner.mjs` → **exit 0**.
- PowerShell AST parse of `t6-runner.ps1` → **OK** (no syntax errors, no execution).
- Static safety review: 12 registered case ids exactly match the matrix's 12 Group-L ids; **0 `COMMIT` on A/B sessions**; port literal 5432 appears only inside guards; 15432 isolation asserted in runner + preflight + bootstrap; `BEGIN ISOLATION LEVEL READ COMMITTED`, `lock_timeout`/`statement_timeout`/`idle_in_transaction_session_timeout`/`ON_ERROR_STOP` present.
- SQL artifacts: no `COMMIT` in setup/preflight/residue/sync; dollar-quote blocks balanced; every `DO $$ … $$;` terminates.

## 8. Known limitations (unchanged from `T6_LAB_DESIGN.md`)
- Local lab mimics only the objects the lifecycle/fence code touches; no RLS/pooler/realtime, no real R2, no Worker runtime.
- Advisory-lock ownership is direct (no pgbouncer), so Group R must use a direct session port, not the pooler.
- Simultaneity is expressed as an observed waiter plus a deterministic release (see §3); this is the faithful implementation of the accepted release semantics, not a pretense of a barrier race.

## 9. GO / BLOCKED recommendation
- **GO (local, Group L):** all 12 cases are implemented and offline-validated. Execution requires the separate `-Confirm I_APPROVE_LOCAL_T6` approval; it then runs against the disposable port-15432 cluster only.
- **BLOCKED without further approval:** anything touching TEST/Supabase (`T6-R*` execution, `T6-C*` committed fixtures), R2, Cloudflare schedules, Workers, migrations, or production.
- **Do not change** `test-harness/harness-registry.mjs`; the T3/T4 classification gap and the unscanned `t5-checkpoint/` subtree remain a separate policy decision.

Artifact checksums are reported in the accompanying message. No repository file was created or modified; worktree state remains 42 modified / 69 untracked / 0 staged.
