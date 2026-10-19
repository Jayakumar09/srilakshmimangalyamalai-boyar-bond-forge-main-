# TEST REPORT — T4

- **Date:** 2026-10-18
- **Environment:** live TEST Supabase `nqadtfqyurkpmxcodswc`, rollback-only
- **Evidence:** `docs/project/TEST_VERIFICATION_LEDGER.md` (T4 addendum)

## Results

| Category | Result |
|---|---|
| Cases | **61/61 PASS (C1–C61)** |
| Request complete-row final-state | **20/20 PASS** |
| Document final-state | **5/5 PASS** |
| Expected deletions / survivors | 2 / 3 |
| `guard_checks` | 123 |
| `fence_difference_count` | 0 |
| Post-rollback residue | **PASS** (0 requests / 0 documents / 0 fences) |
| C1–C8 | expected SQLSTATE `42501` |
| C9–C61 | `00000` with planned returns |

## Evidence and limitations

- **Script SHA-256** (committed at `e54756b`; matches `TEST_VERIFICATION_LEDGER.md` "Script SHA-256 (live / cli-session / residue)"):
  - `slmm-storage-deletion-t4-live-test.sql` = `b56c711aec445ec79ad8f58d0a3b4d9f27116b760b56dfb2a051cbf6d8387d7b`
  - `slmm-storage-deletion-t4-cli-session.sql` = `909db27c39f1d642cc5403cb466ea799355da9f3e7a5b33c6bf8b2ab79b5f8e0`
  - `slmm-storage-deletion-t4-residue.sql` = `c80509ba37a447108e69edfef6eecc3ce6ac01b32593ea34cdb824a7ede6db4e`
- **Raw evidence** (separate; external `%TEMP%`; per ledger "Raw-evidence SHA-256 (T4 live / residue)") — these are evidence digests, not script hashes:
  - live = `bf5f9440276338fcb2a98d0a1ea591f6f7f9ed47506258e0e2235579bb3dba5d`
  - residue = `4b746375614910d0eeac3a30eb7266dfa760de2989d6ad655e79b4eaadde4d3f`
- No claim/batch/fence/quota/cancel RPC with real effect; no parallel-worker contention.
- Does **not** establish end-to-end deletion correctness.

## Residue / rollback

- Mandatory final `ROLLBACK`; separate read-only residue query returned PASS.
