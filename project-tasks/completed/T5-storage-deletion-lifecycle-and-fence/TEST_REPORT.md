# TEST REPORT — T5

- **Date:** 2026-10-19
- **Environment:** live TEST Supabase `nqadtfqyurkpmxcodswc`, rollback-only
- **Evidence:** `docs/project/TEST_VERIFICATION_LEDGER.md` (T5 addendum)

## Results

| Category | Result |
|---|---|
| Group-L… (T5 plan: 49 plan rows / 49 result rows) | 49/49 rows present |
| Executable cases | **48/48 PASS** |
| `D7` (existence-check abort) | **BLOCKED** — needs new hook; case returns not-executed |
| Mandatory final `ROLLBACK` | completed, no SQL error |
| Separate residue query | **PASS** (0 synthetic rows) |

## Evidence and limitations

- Preflight: `T5 preflight OK`, 14 installed-function fingerprints, 6 fence triggers, under `slmm.t5.target_project=nqadtfqyurkpmxcodswc`.
- **Limitation:** the raw verdict JSON was **not captured**; the PASS basis is the error-free run under `-v ON_ERROR_STOP=1` plus the harness raise-on-false contract, not an archived report.
- Does not prove real R2 deletion, concurrency, or end-to-end correctness.

## Residue / rollback

- Mandatory final `ROLLBACK` retained; residue query PASS.
