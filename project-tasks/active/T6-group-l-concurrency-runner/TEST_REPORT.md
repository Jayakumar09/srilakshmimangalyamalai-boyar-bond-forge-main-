# TEST REPORT — T6

- **Dates:** 2026-10-19 (offline prerequisites), 2026-10-20 (one-shot execution attempts; candidate v1/v2/v3 offline validation), 2026-10-21 (one-shot execution of the corrected C9 runner, verdict FAIL; C10 observer self-exclusion correction; **one-shot execution of the C10 runner, verdict PASS**)
- **Environment:** offline prerequisites only, plus **three** local-lab execution attempts that
  started a disposable PostgreSQL 18 cluster on `127.0.0.1:15432` and reached the Group-L
  runner. The first two produced **T6-L01 = FAIL** and the other eleven **NOT RUN** (harness
  defects). The third — the C10 runner on 2026-10-21 at approximately 10:06 IST — produced
  **12 PASS, 0 FAIL, 0 BLOCKED, 0 NOT RUN** and **verdict PASS**. **No Group-L case had ever
  reported PASS before that run.**
- **Executed by:** SLMM local-lab session

## Commands executed (2026-10-19, offline prerequisites)

```
git rev-parse HEAD
git status --porcelain --untracked-files=all
git rev-list --count origin/main..HEAD
Get-FileHash -Algorithm SHA256 %TEMP%\opencode\t6-prep\t6-local-runner.mjs
Get-FileHash -Algorithm SHA256 %TEMP%\opencode\t6-prep\t6-runner.ps1
Get-NetTCPConnection -LocalPort 15432 -State Listen
Get-ChildItem Env: | Where-Object { $_.Name -match 'PG|POSTGRES' }
Get-Process -Id 2676 ; Get-CimInstance Win32_Process -Filter "ProcessId=2676"
Test-Path %TEMP%\opencode\t6lab ; Get-Content %TEMP%\opencode\t6lab\T6LAB_OWNER
```

## Results (2026-10-19, offline prerequisites)

| # | Test | Result | Evidence |
|---|---|---|---|
| 1a | Prereq 1 — `t6-local-runner.mjs` SHA-256 | **PASS** | `e1719be2ac0d432c903035001fdb0774c93641c0fa308073eefcf55e699aa234` |
| 1b | Prereq 1 — `t6-runner.ps1` SHA-256 | **FAIL** | actual `abd83227…c6701b` ≠ expected `fac7926d…20894c` |
| 2 | Prereq 2 — static negative tests (20/20 Node, 15/15 PS) | **NOT RUN** | moot — stopped at prereq 1/3 |
| 3 | Prereq 3 — port 15432 has no listener | **FAIL** | `127.0.0.1:15432` LISTEN, PID 2676 |
| 4 | Prereq 4 — disposable lab dir absent / ownership certain | **FAIL** | `%TEMP%\opencode\t6lab` present; owner marker `pid=5480` ≠ live `2676` |
| 5 | Prereq 5 — no PostgreSQL redirect env vars | **PASS** | no `PG*`/`POSTGRES*` env vars |
| 6 | Prereq 6 — HEAD + preserve 42 modified / 69 untracked | **PASS** | HEAD `eef9b2e6…`; 42 / 69 preserved |
| — | The 12 Group-L concurrency cases | **NOT RUN** | no cluster started |

## Results (2026-10-20, one-shot execution attempt — candidate v1)

Two launcher attempts were made; the first was interrupted by a harness
tool-call abort, the second ran to completion.

| # | Test | Result | Evidence |
|---|---|---|---|
| A | Preflight (Git checkpoint `ed5e2121…`, candidate SHA-256 `7161bd7d…eec9cc`, six prep checksums vs the committed manifest, port 15432 free, lab dir absent, no `PG*`/`SUPABASE_*`/`R2_*` env vars, candidate hash, path ownership) | **PASS** | 0 failures before launch |
| B | Attempt 1 (11:15–11:33 IST) | **INTERRUPTED** | agent-side waiting parent killed during `pg_ctl start`; the orphaned postmaster then failed with the Windows `0xC0000142` (`STATUS_DLL_INIT_FAILED`) fault at 11:33:21. Evidence: `D:\SLMM-T6-EVIDENCE\launcher-20261020-111559-41599433\` |
| C | Attempt 2 (11:38–12:13 IST) — disposable cluster start | **PASS** | `pg.log`: `listening on IPv4 address "127.0.0.1", port 15432`, `database system is ready to accept connections` |
| D | Attempt 2 — survival across the first 5-minute time-based checkpoint | **PASS** | checkpoint completed 11:58:03; **no `0xC0000142` in this attempt** (the cluster ran healthily for 16 minutes) |
| E | Attempt 2 — wrapper progress past `pg_ctl start` | **FAIL (BLOCKED)** | `Invoke-Native` blocked for 20 minutes at 0% CPU with no child processes: the `cmd.exe`/`postgres.exe` descendant inherited the captured stdout/stderr pipe, so the pipeline never reached EOF. Saved snapshot `process-snapshot.WEDGED.txt` shows `cmd.exe` 6200 as parent of `postgres.exe` 9544 |
| F | Attempt 2 — final exit status | **BLOCKED, exit code 2** | `T6 BLOCKED: cluster did not become ready on port 15432 (pg_isready exit 2)`; `exitcode.txt` = `exitcode=2` |
| G | Attempt 2 — disposable cluster cleanup | **PASS** | the candidate's own teardown removed `%TEMP%\opencode\t6lab`; `postrun-state.txt`: `port15432_listeners=0`, `t6lab_exists=False` |
| H | Attempt 2 — the 12 Group-L concurrency cases | **NOT RUN** | no `t6-lab-results.jsonl`, no node log and no verdict file was ever produced |
| I | Attempt 2 — port-5432 Windows service untouched | **PASS** | PID 4828, same start time, same 2 listeners, same 10 postgres processes; never contacted or stopped |
| J | Candidate v2 offline validation (2026-10-20) | **PASS** | `t6-runner-candidate-v2.ps1` SHA-256 `b5a90be2198b186a009971342155e6e4f5ba54cf5f66455d2e8d4bef9d655bce` (54620 bytes); AST 0 errors / 7057 tokens; `-SelfTest` 62/62 PASS (49 v1 safety tests preserved + 13 process-handling tests); deadlock reproducer `t6-deadlock-repro.ps1` SHA-256 `865f3abc0e9e75cd1212dab9e5f3292a1b8760a9d9cc5f631473f73f70c1d88c` (`cmd.exe` + `ping` only) 8/8 expectations held |
| K | Candidate v3 — the two defects found by the final v2 safety review | **PASS (corrected, offline)** | **Defect 1 (unbounded capture):** v2 copied stdout/stderr into an unbounded `MemoryStream`; measured ~1.3 MB/s growth (3.8 MB → 22.8 MB in 18 s) while a descendant held the pipe. **Defect 2 (timeout cleanup):** v2 set `$started = $true` only *after* a successful `pg_ctl start`, so a timed-out or failed start skipped teardown and could leave a postmaster unmanaged on 15432 while the lab data directory was deleted underneath it. Both corrected in v3 (C2c bounded capture, C2e ownership-verified teardown). No execution occurred. |
| L | Candidate v3 offline validation (2026-10-20) | **PASS** | `t6-runner-candidate-v3.ps1` SHA-256 `30e31c1d2c1f14f04bdff78cfd42fa466cb613efa923f099157a347a649ba97c` (139325 bytes, 2520 lines); AST **0 errors / 15442 tokens**; `-SelfTest` **196/196 PASS, exit 0** (62 v2 checks preserved + 68 new C2c/C2d/C2e/C2f checks + 34 new C2g parameter-binding checks + 32 new C2h main-path-initialisation and parameter-binding checks); **8/8 mutants killed** plus **4/4 C2h mutants killed**; **no PostgreSQL started, no database contacted, port 15432 never bound, port-5432 service untouched** (PID 4828, unchanged) |
| M | Candidate v3 final hardening (2026-10-20) | **PASS** | C2f: a truncated or incomplete runner capture is now a **hard failure** (`Assert-NodeCaptureTrustworthy` throws `T6 BLOCKED` on `StdoutTruncated` / `StderrTruncated` / `CaptureIncomplete`), and `Get-T6Verdict` now **requires** a present, well-formed 64-hex-digit runner digest that must match the evidence copy. The evidence byte-identity comparison and both checksum comparisons are **preserved unchanged**. 8/8 mutants killed (digest presence, digest validity, digest-vs-evidence, byte-identity, capture-trust predicate, Node-step gate removal, gate always-throws, gate ordering) |
| N | Candidate v3 one-shot execution attempt (2026-10-20 19:16 IST) | **BLOCKED (launcher exit 1)** | The approved invocation passed `-EvidenceRoot D:\SLMM-T6-EVIDENCE`, but the candidate did not declare that parameter, so PowerShell failed at **parameter binding before the script body ran** (elapsed 1.4 s, empty stdout/stderr). **No evidence directory created, no PostgreSQL started, port 15432 never bound, all 12 Group-L cases NOT RUN.** Evidence retained under `D:\SLMM-T6-EVIDENCE\launcher-20261020-191622-a1e6bf5c\` (`exitcode.txt` = `exitcode=1`, `DIAGNOSIS.txt`, pre/post state, process snapshot) |
| O | Candidate v3 one-shot execution attempt (2026-10-20 20:15 IST) | **BLOCKED (wrapper exit 2)** | The `-EvidenceRoot` parameter **worked**: the invocation bound and the candidate created its evidence directory under `D:\SLMM-T6-EVIDENCE\t6-run-20261020-201516-88ef8d45\`. The run then aborted at the **first** step with `FAILED: The variable '$script:ExitCodes' cannot be retrieved because it has not been set.` -- `$script:ExitCodes` was **never initialised**, and under `Set-StrictMode -Version Latest` that assignment is a terminating error. The run stopped **before `pg_ctl start`**: **no PostgreSQL cluster was ever started**, port 15432 was never bound, and **all 12 Group-L cases remained NOT RUN**. The candidate's ownership-verified teardown removed only its own disposable lab tree; the port-5432 service was untouched (PID 4828, 2 listeners, 10 postgres.exe, unchanged). Evidence preserved under `D:\SLMM-T6-EVIDENCE\launcher-20261020-201457-c2476264\` (`exitcode.txt` = `exitcode=2`, empty stderr, pre/post state, process snapshot) and `D:\SLMM-T6-EVIDENCE\t6-run-20261020-201516-88ef8d45\` |
| P | Candidate v3 one-shot execution attempt (2026-10-20 22:28 IST) | **FAIL (wrapper exit 1)** | The **first** run that reached the Group-L runner. The whole main path executed in 42 s: `initdb`, `pg_ctl start`, `pg_isready`, the identity check, `CREATE DATABASE t6lab`, the bootstrap, the preflight, the Node step, the residue re-check, the evidence copy, the verdict and the teardown. **Every bootstrap and preflight step PASSED** (`initdb=0`, `pgctl_start=0`, `isready=0`, `identity=0`, `create_db=0`, `bootstrap=0`, `preflight=0`, `residue=0`); only `node` exited 1, and the verdict is **FAIL** -- the wrapper correctly refused to report PASS. **T6-L01 = FAIL; the other eleven cases = NOT RUN.** T6-L01 failed because of the runner's **per-case survivor logic**: its detail is byte-for-byte the runner's own success return string for that case plus only ` | force-terminated 2 surviving T6 backend(s)`, so every assertion inside the case passed and **no product RPC failure has been demonstrated**. The check counted the runner's own two long-lived, intentionally reused A/B sessions as leaks. **Evidence digests and residue verified**: the runner-reported digest `d9cdd1c82ec859ef7600306702d7b5604ce42ec9403bff9780d35602cd9058c8` equals the SHA-256 of the evidence copy in `D:\SLMM-T6-EVIDENCE\t6-run-20261020-222837-8ec45d7e\`, and the residue verdict is `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}`. Teardown proved ownership before stopping; post-run `port15432_listeners=0`, `t6lab_exists=False`, and the port-5432 service was untouched (`Running`, 2 listeners, 10 `postgres.exe`). Evidence preserved under `D:\SLMM-T6-EVIDENCE\launcher-20261020-222834-2248bb69\` and `D:\SLMM-T6-EVIDENCE\t6-run-20261020-222837-8ec45d7e\` |

| Q | Candidate v3 one-shot execution of the **corrected C9 runner** (2026-10-21 09:01 IST) | **FAIL (wrapper exit 1)** | The **second** run to reach the Group-L runner, and the **first** run of the corrected C9 runner (`0595bda3...8fc6`). The whole main path executed in 20.7 s: `initdb`, `pg_ctl start`, `pg_isready`, the identity check, `CREATE DATABASE t6lab`, the bootstrap, the preflight, the Node step, the residue re-check, the evidence copy, the verdict and the teardown. **Every bootstrap and preflight step PASSED** (`initdb=0`, `pgctl_start=0`, `isready=0`, `identity=0`, `create_db=0`, `bootstrap=0`, `preflight=0`, `residue=0`); only `node` exited 1, and the verdict is **FAIL** -- the wrapper correctly refused to report PASS. **T6-L01 = FAIL; the other eleven cases = NOT RUN.** **The C9 correction did change the failure mode**: the previous run's ` | force-terminated 2 surviving T6 backend(s)` is gone -- the A/B sessions are no longer misclassified as leaks. The new detail is byte-for-byte the runner's own success return string for T6-L01 plus only ` | obs session is not healthy (open transaction, state=active)`, so every assertion inside the case passed and **no product RPC failure has been demonstrated**. **The new defect is in the audit itself**: `AUDIT_BACKENDS` selected every `slmm-t6-%` backend **without excluding the observing connection's own pid** (unlike `OBS_T6_BACKENDS` / `OBS_T6_ADVISORY`, which carry `pid <> pg_backend_pid()`), and because the audit query is executed *by* the observer, the observer was necessarily `active` inside an open transaction and was judged as an unhealthy expected session. This is a **harness defect, not a concurrency finding**; the offline self-tests could not see it because the C9 self-test modelled the observer as permanently idle. **Evidence digests and residue verified**: the runner-reported digest `5c77320964920c7a52ec75673256ecc115752f21d2a03057eb5c71e9cb94c200` equals the SHA-256 of the evidence copy in `D:\SLMM-T6-EVIDENCE\t6-run-20261021-090109-a3e53a67\`, and the residue verdict is `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}`. Teardown proved ownership before stopping; post-run `port15432_listeners=0`, `t6lab_exists=False`, and the port-5432 service was untouched (`Running`, 2 listeners, 10 `postgres.exe`). The run was launched through a **detached launcher with a waiting parent**, with the stdout/stderr capture ordering **corrected** so the child is started before the asynchronous stream reads begin. Evidence preserved under `D:\SLMM-T6-EVIDENCE\launcher-20261021-090107-6e3008ba\` and `D:\SLMM-T6-EVIDENCE\t6-run-20261021-090109-a3e53a67\` |
| R | C10 observer self-exclusion correction (2026-10-21, OFFLINE) | **PASS (corrected, offline)** | `t6-local-runner.mjs` now carries `AND s.pid <> pg_backend_pid()` in `AUDIT_BACKENDS`, distinguishes the **observing** session from the **inspected** sessions (`{ setup, a, b }`), fails closed when the observer's identity cannot be established, and reconciles the preflight allowance with the audit expectation through the single constant `MAX_T6_INSPECTED_BACKENDS = 3`. **New SHA-256 `9f06b1c396e3634fc86eeab4d73878ce7345d7e7e5bffb0d1fea458d7f76b008` (71700 bytes / 1350 lines)**. Static validation: `node --check` 0 errors; `--self-test` **35/35 PASS, exit 0** (30 previous checks + 5 new C9 checks; the C9 block now holds 15 named checks); **17/17 mutants killed** (the 9 pre-existing C9 mutants plus 8 new ones covering the observer self-exclusion defect). All 12 case bodies, the case IDs, the synthetic identities, the digest reporting, the mandatory residue checks, the ownership limits and the bounded cleanup are **byte-identical**. **No execution occurred; no PostgreSQL was started; no database was contacted; the port-5432 service was untouched.** **This correction is NOT live-tested.** |

| S | Candidate v3 one-shot execution of the **C10 runner** (2026-10-21 ~10:06 IST) | **PASS (wrapper exit 0, verdict PASS)** | The **third** run to reach the Group-L runner, and the **first** in which the whole suite completed with every case passing. GitHub baseline at execution: `84d9e145e852dc9046ffa02c75bbee067aab508d`. The whole main path executed in 23.5 s (launcher 10:06:44 → 10:07:07 IST, child pid 10228): `initdb`, `pg_ctl start`, `pg_isready`, the identity check, `CREATE DATABASE t6lab`, the bootstrap, the preflight, the Node step, the residue re-check, the evidence copy, the verdict and the teardown. **All nine native steps exited 0** (`initdb=0`, `pgctl_start=0`, `isready=0`, `identity=0`, `create_db=0`, `bootstrap=0`, `preflight=0`, `node=0`, `residue=0`) and the verdict block records **zero** failure reasons. Server identity confirmed by the runner's own preflight: `{"preflight":"ok","database":"t6lab","port":15432,"server_addr":"127.0.0.1","isolation":"read committed","listen_addresses":"127.0.0.1","namespace_rows":0}`. **12 PASS, 0 FAIL, 0 BLOCKED, 0 NOT RUN** — all twelve expected ids (`T6-L01`–`T6-L11` incl. `L08a` and `L08b`) present exactly once, no duplicates; runner summary `{"total":12,"pass":12,"fail":0,"blocked":0,"not_run":0,"harness_failed":false,"residue_failed":false}`. **The C10 correction worked as designed**: neither the per-case survivor misclassification nor the observer self-classification appears in this run, and the residue verdict's `other_t6_backends: 0` independently confirms no A/B session was force-terminated as a false leak. **Evidence digests verified three ways**: the runner-reported digest `3489610fbf2105868c8aa2ab6bd60681ac0788446a816980c5cbfd424b187b0c` equals an independent recalculation of the evidence copy's SHA-256, equals the verdict's `runner_sha256`, and equals the run's `artifact-sha256` manifest entry (and was additionally re-derived from the JSONL content alone). **Residue clean**: `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}`. **Ownership-safe cleanup**: the teardown proved ownership before acting (`marker valid, postmaster.pid in our data dir, port 15432, postgres.exe naming our data dir`), stopped with `pg_ctl stop -m fast`, confirmed no live cluster of ours used the laboratory, and only then removed the lab tree; post-run `port15432_listeners=0`, `t6lab_exists=False`, and the port-5432 service was untouched (`Running`, 2 listeners, 10 `postgres.exe`, pid 5148 — identical to the pre-run baseline). The **executed** wrapper was the approved **candidate v3** (`t6-runner-candidate-v3.ps1`, SHA-256 `30e31c1d...97c`) with `-Confirm I_APPROVE_LOCAL_T6 -EvidenceRoot D:\SLMM-T6-EVIDENCE`; the original recovered `t6-runner.ps1` was **never** copied to the preparation directory and was **never executed**. PostgreSQL defaults unchanged. Evidence preserved under `D:\SLMM-T6-EVIDENCE\launcher-20261021-100642-9c43b8d4\` and `D:\SLMM-T6-EVIDENCE\t6-run-20261021-100645-9d2f02f9\` |

## Summary

- 2026-10-19: PASS 3 (prereq 1a, 5, 6); FAIL 3 (prereq 1b, 3, 4); NOT RUN 12 Group-L cases.
- 2026-10-20 execution attempt: the disposable cluster **started** and stayed healthy
  for 16 minutes, but the wrapper **BLOCKED** inside `Invoke-Native` because of the
  pipe-inheritance defect (C2b) and returned **exit code 2**.
- **One Group-L case (T6-L01) has now executed and produced a result; the other eleven are
  still NOT RUN, and no case has reported PASS.** Nothing about concurrency correctness
  is proven.
- Candidate **v1 was executed and returned BLOCKED**. Candidate **v2**
  (`t6-runner-candidate-v2.ps1`, SHA-256
  `b5a90be2198b186a009971342155e6e4f5ba54cf5f66455d2e8d4bef9d655bce`) carries the
  C2b correction but was found by the final offline review to carry two
  further defects — unbounded output capture and timeout cleanup that could
  leave the laboratory unmanaged — and is **NOT EXECUTION-APPROVED**.
- Candidate **v3** (`t6-runner-candidate-v3.ps1`, SHA-256
  `30e31c1d2c1f14f04bdff78cfd42fa466cb613efa923f099157a347a649ba97c`) corrects both defects plus a reader-lifetime defect found while
  validating it (C2c bounded capture; C2e ownership-verified teardown that
  never stops an unproven process and never deletes the lab directory while
  a possibly active PostgreSQL process remains; C2d deterministic reader
  cancellation via `CancelIoEx`; and C2f, which makes a truncated or
  incomplete runner capture a hard failure and requires a present, valid
  runner digest before PASS is possible). The earlier v3 revision
  (`5faae6ebc0a1e422b465b369ab37da8b3049f88190c81eb2f2a00794da21457a`) is superseded. It is **NOT EXECUTION-APPROVED** and has
  **not been executed**.
- **No Group-L case had reported PASS after the first four one-shot execution attempts**
  (this line records the state as of 2026-10-21 09:01 IST and is **superseded by the
  10:06 IST attempt below**, which is the first PASS). The four attempts were:
  The 19:16 IST attempt failed at **parameter binding**, before the candidate body ran (wrapper exit 1; no
  evidence directory created, no PostgreSQL started). The 20:15 IST attempt ran with the repaired
  `-EvidenceRoot` binding and created its evidence directory, but aborted at the first step because
  `$script:ExitCodes` was never initialised (wrapper exit 2); **no PostgreSQL cluster was started**.
  The 22:28 IST attempt **started the disposable cluster on 127.0.0.1:15432 and reached the Group-L runner**
  (wrapper exit 1, verdict FAIL): every bootstrap and preflight step passed, **T6-L01 = FAIL** and the other
  **eleven cases = NOT RUN**. T6-L01's failure is attributable to the **runner's per-case survivor check**,
  which counted the runner's own two intentionally reused A/B sessions as leaks; the case body's own
  assertions all passed, so **no product RPC failure has been demonstrated**.
  The 2026-10-21 09:01 IST attempt (below) likewise produced **T6-L01 = FAIL** and the other
  **eleven cases = NOT RUN**.
- **2026-10-21 09:01 IST — a fourth one-shot execution attempt, this time with the corrected C9 runner**
  (wrapper exit 1, verdict FAIL). Every bootstrap and preflight step passed; **T6-L01 = FAIL** and the other
  **eleven cases = NOT RUN**; residue clean (`synthetic_rows=0`, `other_t6_backends=0`,
  `t6_advisory_locks=0`); evidence digest `5c77320964920c7a52ec75673256ecc115752f21d2a03057eb5c71e9cb94c200`
  matched byte-for-byte; the disposable laboratory was cleaned up with ownership proven first. The C9
  correction **did** remove the previous A/B misclassification, but the audit then **classified its own
  observer** as an unhealthy expected session, because `AUDIT_BACKENDS` did not exclude the observing
  connection's own pid. The case body's own assertions all passed, so **no product RPC failure has been
  demonstrated** and **nothing yet demonstrates concurrency correctness**.
- **2026-10-21 ~10:06 IST — a fifth one-shot execution attempt, this time with the corrected C10 runner:
  WRAPPER EXIT 0, VERDICT PASS, 12 PASS / 0 FAIL / 0 BLOCKED / 0 NOT RUN.** All nine native steps exited
  0 and the verdict block records zero failure reasons. All twelve Group-L cases passed, including
  **`T6-L08a`** and **`T6-L08b`**, each present exactly once with no duplicates. The results digest
  `3489610fbf2105868c8aa2ab6bd60681ac0788446a816980c5cbfd424b187b0c` was verified three ways
  (independent recalculation, the verdict's `runner_sha256`, and the run's `artifact-sha256` manifest).
  Residue was clean (`synthetic_rows=0`, `other_t6_backends=0`, `t6_advisory_locks=0`) and the disposable
  laboratory was cleaned up with ownership proven before the stop and before the deletion. The GitHub
  baseline at execution was `84d9e145e852dc9046ffa02c75bbee067aab508d`. **This is the first Group-L PASS.**
  **Scope:** a local disposable PostgreSQL 18 lab result only — it does **not** prove any Supabase TEST
  or production behaviour, and the **overall T6 program remains INCOMPLETE** (8 R-cases and 3 C-cases
  unexecuted; R2 and scheduler integration are separate pending gates).

- **Correction applied offline (2026-10-20), EXECUTED ONCE on 2026-10-21:** `t6-local-runner.mjs` SHA-256
  `0595bda3562d76056541106a33941638156340ce009a891c6746156922de8fc6` (62766 bytes / 1203 lines) replaced the executed revision `e1719be2ac0d432c903035001fdb0774c93641c0fa308073eefcf55e699aa234` (46751 bytes / 875 lines). The per-case
  survivor check is replaced by a pid-keyed session audit: healthy, idle, transaction-free A/B sessions are
  **expected and reusable**, while an unexpected T6 backend, a non-transaction-clean expected session, a
  missing or ambiguous session identity and a failed cleanup all still FAIL the case. Cleanup stays bounded
  and restricted to positively identified T6-owned backends; a foreign session is never terminated. Offline
  validation: `node --check` 0 errors, `--self-test` **30/30 PASS exit 0** (21 original + 10 new C9 checks),
  **9/9 C9 mutants killed**. All 12 case bodies, the case IDs, the synthetic identities, the digest reporting
  and the mandatory residue checks are byte-identical. **This revision was executed once on 2026-10-21 and
  produced the observer self-classification failure described above.**

- **Correction applied offline (2026-10-21), EXECUTED ONCE ON 2026-10-21 (~10:06 IST) — VERIFIED PASS:**
  `t6-local-runner.mjs` SHA-256
  `9f06b1c396e3634fc86eeab4d73878ce7345d7e7e5bffb0d1fea458d7f76b008` (71700 bytes / 1350 lines) replaces the
  `0595bda3...` revision. The **C10** correction excludes the observing connection's own backend from the
  inspection query with `AND s.pid <> pg_backend_pid()`, **distinguishes the observing session from the
  inspected sessions** (`{ setup, a, b }` are inspected; the observer is the fourth), **fails closed** when
  the observer's identity cannot be established, and **reconciles** the preflight allowance with the audit
  expectation through the single constant `MAX_T6_INSPECTED_BACKENDS = 3`. The detection of unexpected
  T6-owned sessions, the missing-session, ambiguous-identity, unclosed-transaction, advisory-lock and
  cleanup-failure checks, the rule that a foreign session is never terminated, the bounded cleanup, the case
  bodies, the case IDs, the synthetic identities, the digest reporting and the mandatory residue checks are
  all **preserved unchanged**. Offline validation: `node --check` 0 errors, `--self-test` **35/35 PASS exit 0**
  (30 previous + 5 new C9 checks; the C9 block now holds 15 named checks), **17/17 mutants killed** (the 9
  pre-existing C9 mutants plus 8 new ones covering the observer self-exclusion defect). **This revision has
  since been executed exactly once and returned PASS with 12/12 Group-L cases passing — see the row S
  entry and the 10:06 IST summary bullet above.** The checksum manifest, `TASK.md` and the temporary
  preparation copy all pin this revision.
## Evidence and limitations

- The 2026-10-20 attempt's evidence is durable under `D:\SLMM-T6-EVIDENCE\`
  (`launcher-20261020-111559-41599433\`, `launcher-20261020-113741-b4d0aac5\`,
  `t6-run-20261020-111611-35af3ca5\`, `t6-run-20261020-115251-73f019ca\`).
- The **2026-10-21** attempt's evidence is durable under `D:\SLMM-T6-EVIDENCE\`
  (`launcher-20261021-090107-6e3008ba\`, `t6-run-20261021-090109-a3e53a67\`). The
  launcher directory holds the stdout log, the stderr log (empty), the exit code,
  the started/finished timestamps, the child pid, the preflight and postrun state
  files, a process snapshot and the launcher script itself
  (`launcher-t6_launch_c9.ps1.approved-run`); the run directory holds the run log,
  the node log, the results JSONL, the verdict JSON and the artifact checksum
  file. All four historical run directories and both historical launcher scripts
  are **intact and unmodified**.
- The **2026-10-21 ~10:06 IST PASS attempt's** evidence is durable under
  `D:\SLMM-T6-EVIDENCE\`
  (`launcher-20261021-100642-9c43b8d4\`, `t6-run-20261021-100645-9d2f02f9\`). The
  launcher directory holds the stdout log, the stderr log (empty), the exit code
  (`exitcode=0`), the started/finished timestamps, the child pid, the preflight
  and postrun state files, a process snapshot and the launcher script itself
  (`launcher-t6_launch_c9.ps1.approved-run`); the run directory holds the run log,
  the node log, the results JSONL (12 records, all `PASS`), the verdict JSON
  (`"verdict": "PASS"`, zero reasons) and the artifact checksum file. **All
  earlier run directories, launcher directories and launcher scripts — including
  those of the earlier FAIL attempts — are intact and unmodified, and their
  FAIL outcomes are not relabelled.**
- The PostgreSQL server log for the attempt is preserved as
  `lab-pg.log.PRE-INTERVENTION`; the wrapper's own log is preserved as
  `candidate-run-log.WEDGED.log`.
- **Limitation:** the runner's Node stage was never reached in the 2026-10-20
  attempts, so those produced **zero** Group-L case results. The 2026-10-20
  22:28 attempt and the 2026-10-21 09:01 attempt each produced **one** case
  record (T6-L01 = FAIL). The 2026-10-21 ~10:06 IST attempt produced **twelve**
  case records, all PASS.
- **Limitation (scope of the 2026-10-21 ~10:06 IST PASS):** this is a **local
  disposable PostgreSQL 18 lab** result on `127.0.0.1:15432` against database
  `t6lab`. It demonstrates the 12 Group-L concurrency cases **in that lab only**.
  It does **not** prove any Supabase TEST or production behaviour, and it says
  nothing about the hosted PostgreSQL's version, its `pg_locks` /
  `pg_stat_activity` semantics, its timing, or its infrastructure. The
  **overall T6 program remains INCOMPLETE**: the case matrix defines 23 cases
  across three environments, and the 8 R-cases (TEST Supabase, rollback-only)
  and 3 C-cases (TEST Supabase, committed fixtures — still BLOCKED pending
  separate operator approval) have **not** been executed. R2 / object-storage
  and scheduler integration are separate pending gates; no R2, Cloudflare or
  Worker operation was performed and the scheduler was never activated.
- **Limitation (2026-10-20, candidate v3):** all v3 validation is **static and
  offline**. The 164 self-tests use harmless simulated processes (`cmd.exe`
  and `ping` only), simulated capture-result objects and disposable filesystem
  sandboxes. No PostgreSQL process
  was started, no database was contacted, port 15432 was never bound, and the
  port-5432 service was never contacted or stopped (PID 4828, unchanged
  start time and listeners). The 45 new checks therefore prove the *wrapper's
  own* capture, timeout and ownership logic — they prove **nothing** about
  PostgreSQL or about concurrency behaviour.
- **Limitation (2026-10-21, C10 correction):** the C10 correction was validated
  **entirely offline** before the run. Its 35 self-tests use simulated backend rows and
  simulated capture-result objects only; the source-level assertions read the
  runner's own file. During that offline validation **no PostgreSQL process was started, no database was
  contacted, port 15432 was never bound, and the port-5432 service was never
  contacted or stopped** (`Running`, 2 listeners, 10 `postgres.exe`, unchanged
  across the session). The 5 new checks and the 8 new mutants prove the
  *runner's own* classification and exclusion logic. The correction was
  subsequently **live-tested** on 2026-10-21 at approximately 10:06 IST, where it
  was exercised against a real disposable cluster and the full 12-case matrix
  passed (see the PASS row S entry).
- **Limitation:** a local-lab pass, if one is ever obtained, still would not prove
  any Supabase TEST or production behaviour.

## Residue / rollback results

- The disposable cluster was **started** on `127.0.0.1:15432` and **cleaned up** by
  the candidate's own teardown (`pg_ctl stop -m fast`, then the lab directory was
  removed). Post-run state: `port15432_listeners=0`, `t6lab_exists=False`.
  This held for **all three** attempts that reached the Group-L runner: the
  2026-10-20 22:28 attempt, the 2026-10-21 09:01 attempt and the 2026-10-21
  ~10:06 attempt. In the 2026-10-21 attempts the teardown **proved ownership first**
  (`marker valid, postmaster.pid in our data dir, port 15432, postgres.exe
  naming our data dir`) and only then stopped the cluster and deleted the lab
  tree; the port-5432 service was unchanged throughout (`Running`, 2 listeners,
  10 `postgres.exe`).
- The **2026-10-21 09:01** run's own residue verdict was clean:
  `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}`.
- The **2026-10-21 ~10:06** PASS run's residue verdict was also clean:
  `{"synthetic_rows":0,"other_t6_backends":0,"t6_advisory_locks":0}` — zero
  synthetic rows, zero unexpected T6 backends and zero advisory locks. The
  `other_t6_backends: 0` value is the runtime confirmation that the runner's own
  reusable A/B sessions were no longer misclassified as leaks and
  force-terminated. The teardown additionally confirmed that **no live cluster
  of ours** used the laboratory before the lab tree was deleted.
- No residue in the repository, in the prep directory, or in the port-5432 service,
  which was never contacted.
