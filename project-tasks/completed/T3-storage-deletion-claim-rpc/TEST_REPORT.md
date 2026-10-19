# TEST REPORT — T3

- **Date:** 2026-10-18
- **Environment:** live TEST Supabase `nqadtfqyurkpmxcodswc`, rollback-only
- **Evidence:** `docs/project/TEST_VERIFICATION_LEDGER.md` (T3 addendum)

## Results

| Category | Result |
|---|---|
| Cases | **14/14 PASS (C1–C14)** |
| Complete-row final-state checks | **11/11 PASS** |
| `overall_verdict` | **PASS** |
| `claim_count` | 5 |
| `fence_difference_count` | 0 |
| Residual | **PASS** — 0 requests / 0 residue |
| C1/C2 (SQLSTATE 42501) | Expected auth denial confirmed |

## Evidence and limitations

- Raw JSON kept outside Git (`%TEMP%`); retention not guaranteed.
- Script SHA-256: `bf53a30c…f59a1c` (live), `159004c1…7fa52ca` (residue).
- Live T3 only: R2 deletion and end-to-end Worker behavior untested.

## Residue / rollback

- Mandatory final `ROLLBACK`; separate read-only residue query returned PASS.
