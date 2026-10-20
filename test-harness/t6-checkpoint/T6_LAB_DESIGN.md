# T6 LOCAL LABORATORY DESIGN & SAFETY AUDIT

**Status:** DESIGN ONLY — NOT EXECUTED. Offline, read-only; no repository modifications.
**Checkpoint:** `eef9b2e607346f3560af5baf1f170932455a9b44` · **TEST project (R-group planning):** `nqadtfqyurkpmxcodswc` (never production)
**Scope:** L01–L11 (Group L, local PG 18) — Group R/C as planned

## 1. Design goals (explicit requirements)
- **Two independent connections**, never a single process pretending to be concurrent; sync is **state-based** (pg_locks ⋈ pg_stat_activity), **never sleep-based**.
- **Isolated port** (no reuse of Windows service on 5432). Candidates: 15432 (free). Cluster lives in `%TEMP%\opencode\t6lab\` (data/run), disposable.
- **Committed synthetic fixtures only inside the disposable cluster** (so row-level races are real). No committed fixtures on TEST in L/R (C is blocked).
- **READ COMMITTED** for L (deliberate deviation from T3–T5 REPEATABLE READ; matches production/Worker path and EvalPlanQual resolution; see §5).
- **Bounded waits:** `lock_timeout`, `statement_timeout`, `idle_in_transaction_session_timeout` on both sessions.
- **Fail-closed:** ON_ERROR_STOP=1; every exit path issues ROLLBACK; zero COMMIT allowed; final residue + backend/lock hygiene.
- **No repository touch:** all draft files here remain in `%TEMP%\opencode\t6-prep\`.

## 2. Cluster lifecycle (disposable, isolated)
| Step | Command (Windows/pg_ctl) | Rationale |
|---|---|---|
| Cluster root | `%TEMP%\opencode\t6lab\{data,run}` | Temporary, per run |
| `initdb` | `initdb.exe -D %TEMP%\opencode\t6lab\data -N -U postgres -A trust` | Throwaway, trust local only (no network exposure) |
| `pg_ctl start` | `pg_ctl start -D ... -l %TEMP%\opencode\t6lab\run\pg.log -o "-p 15432 -B 8 -k %TEMP%\opencode\t6lab\run -c listen_addresses=''"` | Isolated port 15432, Unix-domain socket in temp, listen_addresses empty (local-only) |
| Bootstrap | `psql -h %TEMP%\opencode\t6lab\run -p 15432 -U postgres -d postgres` load `lab/lab-schema.sql` + migrations 20261017120000..150000 verbatim | Fidelity to committed migrations |
| Run L01–L11 | two `psql` children, `application_name='slmm-t6-a'`, `'slmm-t6-b'` | Independent connections |
| Shutdown | after residue: `pg_ctl stop -D ... -m fast` (or `immediate` if abandoned); delete `%TEMP%\opencode\t6lab\` | Guaranteed cleanup |
| Safety | never touches the running service on 5432 | Explicit isolation |

Notes: Windows `postgresql-x64-18` service is running on 5432 — **must not be reused**. All connections use `-p 15432` and the temp socket (`-h ...\run`) or localhost with empty listen_addresses (local-only). No external network.

## 3. Limitations in local lab schema vs managed TEST
| Difference | Impact | Mitigation |
|---|---|---|
| No RLS, no realtime, no pgbouncer/pooler | Advisory-lock ownership/pg_locks pid attribution is direct (cleaner). | R-group must use direct session port (no pooler); L uses direct local connections. |
| `auth.uid()/role()` read session GUCs only (as in lab) | Mirrors the JWT-injection style used by T3/T5 (`t5_jwt()` sets claim GUCs). | Identity mechanism identical to harness. |
| `pg_advisory_xact_lock(hashtextextended(...,0))` version parity | 64-bit lock key computed by PostgreSQL; local PG18 vs managed unknown. | Do **not** compute hash client-side; detect waits by reading `pg_locks` (by classid/objid for the pid holding the transaction) — the keyspace is stable but we observe the lock, not infer its value. |
| Constraints match lab + `payments_method_allowed` (embedded, added because of E6 drift) | Prevents fixture-induced 23514 unrelated to fence; lab now matches committed TEST constraints. | Yes — matches b25555e lab correction. |
| No real R2, no Worker runtime | L covers DB concurrency only (correct scope). | Out of scope for T6 (matches plan). |

Conclusion: lab is sufficiently faithful for the locking/claim/fence SQL; any behavioral divergence is confined to pooler/pgbouncer (R must use direct port) and not to the SQL text under test.

## 4. Synchronization protocol (state-based, bounded)
Two sessions A (`slmm-t6-a`), B (`slmm-t6-b`), each `BEGIN ISOLATION LEVEL READ COMMITTED;` with:
```sql
SET LOCAL application_name = 'slmm-t6-a';  -- or -b
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SET LOCAL search_path = pg_catalog, pg_temp;
```
**Handshake primitives:**
- `have_granted(pid, appname)` → true if session with appname has a granted advisory lock (`granted=true`) in `pg_locks l JOIN pg_stat_activity a ON l.pid=a.pid` and the lock is the transaction-scoped advisory lock for the test key (or we detect the peer's pid).
- `have_waiter(on_pid, appname)` → true if appname is waiting on on_pid's lock (`granted=false`) and `waitstart`/state indicate waiting.

**Race cases (L01–L06,L08b):** A sets up fixture, begins transaction, signals "ready", polls until B is waiting on A's lock (or A sees B's granted lock, depending on order), then proceeds. B polls until it observes A's granted lock (or A ready), then issues its claim/fence/insert. All loops use `pg_sleep(0.01)` or 10 ms back-off, with total timeout < `lock_timeout` (≤9 s) to avoid 55P03 from sync polling. **Never fixed `sleep(N)` guessing execution time.**

**Ordering:** L11 uses opposite orders with `lock_timeout='2s'` (expected 55P03). R04 uses 3s. Otherwise 10s for sync, 30s for statements.

**Exactly-one-winner check:** after both finish (or one times out), inspect `storage_deletion_requests` rows for the T6 keys — winner rows have one distinct `lease_token` (single-claim) or disjoint id sets (batch). Any duplicate token/id ⇒ FAIL; any row count or token ambiguity ⇒ FAIL; zero winners and a timeout ⇒ record BLOCKED (connection/timeout), never PASS.

## 5. Isolation rationale (READ COMMITTED)
T3–T5 used `REPEATABLE READ` (single-session determinism). For **cross-session** races, the production path is READ COMMITTED (Worker/PostgREST). Under RC, the single-claim `UPDATE … WHERE … (status IN … AND lease_expiry checks)` does EvalPlanQual re-check after the row-lock wait — this produces **exactly one winner** deterministically in the race (the transaction that locks the row last and passes the WHERE still holds the current snapshot version). Under RR, the loser would abort with **40001** (serialization failure), which is indistinguishable from a real defect in the contention behavior we want to verify.

Migration comments at `…150000:92–96` explicitly document that the trigger acquires the per-key advisory lock and that after the wait the snapshot is taken (RC) so the committed fence is seen; this matches the intended behavior. L therefore uses `ISOLATION LEVEL READ COMMITTED`. Preflight/guards for R/L must **assert RC for T6**, not RR (documented deviation, deliberate).

## 6. Case-by-case design (L01–L11) — synchronization details
| ID | Synchronization point | Assertion (exact) |
|---|---|---|
| L01 | barrier: A starts, creates pending; A polls pg_locks for B waiting on A's xact lock? Or both call near-simultaneously; better: A `BEGIN`, selects pending row id `FOR UPDATE` (or just calls claim) while B polls `pg_locks` to see A has a lock on that row, then B issues claim. Or simpler: two parallel shells, both sleep-poll for peer pid via a temp table (state exchange) — but temp tables not shared. Prefer: after BEGIN, each writes its pid+appname+case to a small temp table in its own session and polls the peer's row in `pg_stat_activity` (cross-session read of pg_stat_activity) plus `pg_locks` filtered by those pids. |
| L01 detail | "exactly one winner": winner's RETURN SET has 1 row, loser's RETURN SET has 0 rows. `attempt_count` becomes `initial+1` for winner; `attempt_count` never becomes +2. Exactly one distinct `lease_token` across both result sets. |
| L02 | backdate `lease_expires_at = now()-'10 min'`, `status='deleting'`, `attempt_count=2`, `lease_token` non-null; barrier, simultaneous claims. Winner attempt_count becomes 3, token replaced. |
| L03 | loser session (returned 0) immediately calls `block_storage_deletion` with the **token it tried to pass** (the one it constructed) and/or the pre-race token; expect `block_storage_deletion` returns `false`. Then compare full-row snapshots (all columns) of that request row before/after the stale call — must be identical. |
| L04 | A claims (token1), session continues; set lease_expires_at backdated; B claims (token2); A calls `set_r2_confirmed_absent(token1)` → returns `false`; row retains token2, r2_state unchanged. |
| L05 | 6 pending committed: each claim_batch(6). Use a shared token strategy (the function generates one token per UPDATE); intersection of returned id sets empty; every id in eligible set; no id returned twice across sessions; claim completes < lock_timeout. Union size not required. |
| L06 | A does `SELECT id FROM storage_deletion_requests WHERE id=X FOR UPDATE` (open txn), signals ready; B calls `claim_storage_deletion_requests(3)` (includes X+2 others) — B must **not return X**, and must complete **without waiting** on A's row lock for >10ms (elapsed < lock_timeout). After A ROLLBACK, follow-up claim returns X. This tests SKIP LOCKED + not blocking on a held row. |
| L07 | 2 blocked with `updated_at = now()-'30 min'` (and status blocked, no lease), 1 blocked `updated_at = now()-'2 h'`. Simultaneous batch claims; exactly the 2h row claimed exactly once across both sessions; 30m rows never returned. |
| L08a | sequential: A creates request (committed), B creates same key → returns A's id, exactly one live row. |
| L08b | A `BEGIN`, calls `request_storage_deletion(K)` (uncommitted), polls until B is waiting on A's advisory lock; B calls same (will wait at lock taken by A at `…140000:140`); wait observed via `pg_locks` (B has `granted=false` waiting on A's pid); then A `ROLLBACK`; B creates its own row successfully; exactly 1 live row. |
| L09 | A claims (committed), get pid; `pg_terminate_backend(A.pid)`; B reclaims with attempt+1, new token. No T6 backend survives post-check. |
| L10 | A `BEGIN`, claims (uncommitted), get pid; `pg_terminate_backend(A.pid)`; row byte-identical to pre-race; B claims immediately. |
| L11 | opposite orders: A locks K1 then K2, B locks K2 then K1, `lock_timeout='2s'`. Expect ≥1 55P03 (lock_timeout), 0 40P01; both ROLLBACK, no held locks at end. (Note: production paths take one advisory lock per op; this bounds general risk.) |

## 7. Draft implementation files (outside repo) — proposed
Create under `%TEMP%\opencode\t6-prep\t6lab-src\` (never repo):

| File | Purpose |
|---|---|
| `t6-lab-setup.sql` | `initdb` bootstrap (lab-schema + migrations 120000–150000) |
| `t6-preflight-lab.sql` | L preflight: port 15432, namespace purity, fingerprints + 6 triggers, isolation RC, timeouts, server settings, no T6 backends |
| `t6-case-L01..L11.sql` (paired A/B or shared harness) | Per-case fixture + sync + assertions + per-session JSON emit |
| `t6-sync.sql` | Reusable state-based sync helpers (poll pg_locks/pg_stat_activity, check peer ready/waiting, deadline) |
| `t6-session-a.sql`, `t6-session-b.sql` | Session drivers (emit one JSON line per case; ON_ERROR_STOP; ROLLBACK on exit) |
| `t6-runner.ps1` | PowerShell: initdb, pg_ctl start on 15432, bootstrap, run A/B in parallel, collect JSON, run residue, pg_ctl stop, cleanup, compute SHA-256s |
| `slmm-storage-deletion-t6-lab-residue.sql` | Same as t6-residue but for lab (port-agnostic) |
| `T6_LAB_IMPLEMENTATION_PLAN.md` | This document + implementation details |

JSON emission: each session writes `{"case":"T6-L01","session":"A","t":ISO8601,...,"outcome":"PASS|FAIL|BLOCKED","detail":"..."}` to `t6-lab-results-A.jsonl`, `t6-lab-results-B.jsonl`; merged, hashed.

## 8. Safety, shutdown & hygiene
- `lock_timeout=2s` where timeout is expected; 10s for sync; `statement_timeout` 30s; `idle_in_transaction_session_timeout` 60s.
- `ON_ERROR_STOP=1` on both; wrapper traps errors and forces `ROLLBACK`.
- Post-run: require zero `application_name LIKE 'slmm-t6-%'` backends; zero advisory locks attributable to T6; lab cluster stopped (`pg_ctl stop -m fast`); temp dir removed; residue PASS.
- `pg_terminate_backend` only as a recorded last resort (L09/L10); every such action logged with case id and pid.
- Statement allowlist (informal): BEGIN/SET/SELECT/INSERT/UPDATE/DELETE/DO/ROLLBACK only; **no COMMIT** anywhere (R06).
- Port 15432 never conflicts with service on 5432; local-only (`listen_addresses=''`, temp socket).

## 9. GO / BLOCKED
- **GO (local):** L01–L11 against disposable local cluster (15432). No TEST/R2/Cloudflare/production contact.
- **GO (TEST R) with prerequisites:** as before (direct session port, no pooler, explicit authorization, captured JSON+SHA-256).
- **BLOCKED:** C (committed fixtures on TEST) — requires separate approval.
- **Registry note:** T3/T4 unclassified and `t5-checkpoint/` unscanned (fail-closed test red) — **do not change** registry; this remains a separate policy decision.

## 10. Artifacts (outside repo) — for this design phase
These were already produced: `t6-case-matrix.json`, `T6_PREPARATION_PLAN.md`, `slmm-storage-deletion-t6-residue.sql`. This design adds `T6_LAB_DESIGN.md` (SHA-256 to be recorded after write below).

Artifacts will stay in `%TEMP%\opencode\t6-prep\`. No files added to the repository. The worktree remains: 42 modified / 69 untracked / 0 staged (identical to baseline).