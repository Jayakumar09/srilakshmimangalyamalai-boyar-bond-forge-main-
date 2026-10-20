# T6 PREPARATION PLAN — storage-deletion concurrency & lock-serialization

**Status: PLANNED — NOT EXECUTED.** Offline/read-only preparation only.
**Checkpoint:** `eef9b2e607346f3560af5baf1f170932455a9b44` · **TEST project:** `nqadtfqyurkpmxcodswc` (never production).
**Companion artifacts:** `t6-case-matrix.json`, `slmm-storage-deletion-t6-residue.sql` (both drafts, outside the repository).

## 1. Why T6 exists
T3/T4/T5 proved DB semantics, state transitions and fence outcomes **single-session**. Static contract suites pin `FOR UPDATE SKIP LOCKED` and the advisory lock text but explicitly do not verify concurrency. No test has ever had two live sessions contending. T6 is the first two-session phase.

## 2. Environment split (the central design constraint)
Uncommitted fixtures are invisible to the competing session, so **row-level races (claims, CAS, SKIP LOCKED) require committed fixtures**:

| Env | Meaning | Covers |
|---|---|---|
| **L** | local disposable PostgreSQL 18 cluster (`initdb`/`pg_ctl` present) | all claim/CAS/SKIP LOCKED races, crash recovery, deadlock-bounding, **and** the cross-session fence rejection outcome (committed fence is fine locally) |
| **R** | TEST Supabase, two psql sessions, **zero COMMIT ever** | only matters that do not need cross-session row visibility: advisory-lock wait/serialisation, bounded-timeout fail-closed behaviour, duplicate-creation serialisation, hygiene and residue |
| **C** | TEST Supabase with committed synthetic fixtures + cleanup | the R-L01/L05/C03 races on TEST — **BLOCKED pending separate approval** |

Explicitly forbidden as evidence: temp tables, dblink/FDW, agent-simulated "second session", or `SET`-leaked identity — none is real concurrency.

## 3. Isolation and lock analysis
- **READ COMMITTED for T6** (deviation from T3–T5's REPEATABLE READ, which was a single-session determinism device). Reasons: the Worker/PostgREST path is READ COMMITTED; under RC the single-claim `UPDATE` race resolves by EvalPlanQual re-check after the row-lock wait (exactly one winner), while under RR the loser aborts with 40001, which is indistinguishable from a real defect. Likewise the fence/trigger functions document fresh post-wait reads under RC (`20261017150000:92–96`).
- **Lock inventory (from source):** one advisory lock form — `pg_advisory_xact_lock(pg_catalog.hashtextextended(<key>,0))` — taken by request creation (`…140000:140`), failure transition, `fence_storage_key_for_deletion` (`…150000:185`) and `enforce_storage_key_fence` (`…150000:97`). Claim uses row locks only (`…140000:273–276`; batch adds `FOR UPDATE SKIP LOCKED`, `…140000:329`); finalize uses `FOR UPDATE` (`…140000:491`).
- **Never recompute the hash client-side:** local PG 18 vs managed PG version parity for `hashtextextended` is unproven. Sessions identify locks by reading `pg_locks` (`classid`/`objid`) for a PID they own or that carries a T6 `application_name`.
- **Managed vs local differences:** pgbouncer/pooler (port 6543) breaks advisory-lock ownership and `pg_locks` pid attribution → **direct session port only**; Supabase may impose server-side `statement_timeout`/`idle_in_transaction_session_timeout` → the harness `SET LOCAL`s explicit values so behaviour is version-independent; local PG has no such defaults, so the same explicit SETs are used in L.
- **Collision risk:** advisory locks share one 64-bit key space with the quota per-owner lock; a T6 key is `<fresh-uuid>/t6/…`, so cross-feature collision is limited to a 64-bit hash coincidence (negligible, recorded as a risk).

## 4. Two-session runner design (deterministic, bounded, fail-closed)
- Two `psql` processes, `-v ON_ERROR_STOP=1`, distinct `application_name` tags (`slmm-t6-a`, `slmm-t6-b`), `SET LOCAL lock_timeout` (e.g. `10s` for serialisation cases, `3s` where a timeout is the expected outcome), `statement_timeout` (`30–90s`) and `idle_in_transaction_session_timeout` (`60–120s`).
- **Sync is state-based, never sleep-based:** each session polls `pg_locks` joined to `pg_stat_activity` (by `application_name` + pid) for (a) the peer's *granted* advisory lock, or (b) a *non-granted* advisory lock waiting on the holder. All polls are bounded loops inside SQL; a missed handshake degrades to the case's BLOCKED outcome, never a hang.
- Every session wraps its work in `BEGIN … ROLLBACK`; a wrapper ensures `ROLLBACK` is attempted on every exit path.
- **Connection death / timeout recovery:** PostgreSQL aborts the dead backend's transaction and releases all its locks (xact advisory locks at txn end), unblocking the peer; the survivor issues `ROLLBACK` and quits; the affected case is recorded **BLOCKED (connection lost)**, never PASS; `idle_in_transaction_session_timeout` is the server-side safety net for an abandoned terminal; last resort is `pg_terminate_backend` (recorded).
- Statement allowlist: `BEGIN/SET/SELECT/INSERT/UPDATE/DELETE/DO/ROLLBACK` only — any `COMMIT` fails the case set (T6-R06).
- Output: one JSON line per session per case, redirected to a file whose SHA-256 is recorded (this fixes the T5 "JSON not captured" evidence gap).

## 5. Fresh identity + preflight (required before any live execution)
Namespace: owner `5d8f1c62-9a37-4e0b-b1f4-7c0e2a6d9f41`, other `9a4b7e20-…`, admin `c3f7b518-…`, key prefix `5d8f1c62-…/t6/` — distinct from T3 `e17a398c-…`, T4 `b426ac5e-…`, T5 `f3b42871-…`(+2).
`slmm-storage-deletion-t6-preflight.sql` must assert:
1. project guard `SET slmm.t6.target_project='nqadtfqyurkpmxcodswc'` and current setting matches;
2. the **14 installed-function MD5 fingerprints** (same list as T5 preflight, CRLF→LF normalised) and the **6 fence triggers** present on the six relations;
3. EXECUTE grant matrix (anon/authenticated/service_role) unchanged;
4. T6 namespace purity — zero matches for every T6 id and the key prefix in all ten relations;
5. server-settings snapshot (`transaction_isolation`, `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`, `deadlock_timeout`) recorded;
6. identity mechanism present (`set_config('request.jwt.claim.role'/'sub')` + `SET LOCAL ROLE`), as used by T3/T5;
7. operator-side: scheduler/Worker cron confirmed inactive (T4 precedent) and guard configuration disabled.

## 6. Local disposable PostgreSQL strategy
`initdb` a temp cluster under `%TEMP%`, start on a private port with `pg_ctl`, apply the committed `test-harness/t5-checkpoint/lab/lab-schema.sql` plus the Finding 2–5 migrations, then run the L-case pair. The cluster (and every committed fixture) is discarded with `pg_ctl stop` + directory deletion — no residue concern, which is exactly why committed fixtures belong here. PG 18 is installed locally (`C:\Program Files\PostgreSQL\18\bin`); no Docker is available.

## 7. Residue check
`slmm-storage-deletion-t6-residue.sql`: `BEGIN READ COMMITTED READ ONLY`, counts the ten relations for the T6 namespace, asserts zero surviving `slmm-t6-%` backends (which implies zero T6-held advisory locks), raises fail-closed on any nonzero result.

## 8. Risks
1. **Advisory-lock waits** on shared relations (`documents`, `payments`, …) — bounded by `lock_timeout`; T6 keys cannot equal real keys, so no real workload can be locked by T6 (only 64-bit hash coincidence, negligible).
2. **Abandoned sessions** holding row/advisory locks — `idle_in_transaction_session_timeout` + explicit ROLLBACK + post-run backend check; R-group only ever locks synthetic keys.
3. **Synthetic namespace collision** — fresh v4 ids; preflight asserts absence; residue asserts zero.
4. **Genuine queued deletion work** — R-group commits nothing, so no worker can claim anything of ours; C-group would commit claimable `pending` rows and therefore requires scheduler-inactive verification and immediate cleanup.
5. **Version divergence local vs managed** (`hashtextextended`, default timeouts, pooler) — mitigated as in §3; L results are local evidence only and never substitute for R/C results.
6. **New harness files vs the fail-closed registry** — adding T6 `.sql` files requires classification in `harness-registry.mjs` (`LIVE_SQL_HARNESSES`), and the registry test is already red because T3/T4 (and the whole un-scanned `t5-checkpoint/` subtree) are unclassified. The T6 file addition must therefore be paired with the registry remediation under separate approval.

## 9. Artifacts proposed for the future T6 checkpoint (not yet created in the repo)
| File | Purpose |
|---|---|
| `test-harness/t6-checkpoint/slmm-storage-deletion-t6-preflight.sql` | identity + fingerprints + namespace purity |
| `test-harness/t6-checkpoint/slmm-storage-deletion-t6-session-a.sql` | session A driver |
| `test-harness/t6-checkpoint/slmm-storage-deletion-t6-session-b.sql` | session B driver |
| `test-harness/t6-checkpoint/slmm-storage-deletion-t6-residue.sql` | residue/hygiene (draft already prepared) |
| `test-harness/t6-checkpoint/t6-case-matrix.json` | machine-readable matrix (draft already prepared) |
| `test-harness/t6-checkpoint/T6_PREPARATION_PLAN.md` | this plan |
| `test-harness/t6-checkpoint/lab/*` | disposable-cluster harness for the L cases |

## 10. GO / BLOCKED
- **GO now:** this offline preparation; the **local (L) phase** can be built and run as soon as it is authorized, with no TEST/R2/production contact.
- **GO with prerequisites:** TEST **R** phase — needs explicit execution approval, fresh preflight pass, verified direct-session connectivity, and captured JSON.
- **BLOCKED:** TEST **C** phase (committed fixtures) — separate approval required; R2/Worker/runtime components remain out of scope for T6 entirely.
