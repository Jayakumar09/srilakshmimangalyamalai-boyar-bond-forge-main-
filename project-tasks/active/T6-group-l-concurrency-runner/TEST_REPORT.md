# TEST REPORT — T6

- **Date:** 2026-10-19
- **Environment:** offline prerequisites only — **no** live/local DB execution occurred
- **Executed by:** SLMM local-lab session

## Commands executed

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

## Results

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

## Summary

- PASS: 3 (prereq 1a, 5, 6)
- FAIL: 3 (prereq 1b, 3, 4)
- BLOCKED: n/a
- NOT RUN: 12 Group-L cases; prereq 2 (moot)

## Evidence and limitations

- Evidence for the three failures is reproducible from the commands above and is
  recorded in `PROGRESS.md`.
- **Limitation:** the runner was never executed, so **zero** Group-L case results
  exist. Nothing about concurrency correctness is proven by this report.

## Residue / rollback results

- Not applicable — nothing ran. PID 2676 and the lab directory were intentionally
  left untouched.
