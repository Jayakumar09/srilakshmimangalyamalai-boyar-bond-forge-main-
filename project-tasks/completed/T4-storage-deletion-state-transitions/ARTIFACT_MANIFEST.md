# ARTIFACT MANIFEST — T4

- **Baseline HEAD:** `1ba4351` (recorded retrospectively)

## Committed scripts

| # | Filename | Repo location | SHA-256 | Commit | Status |
|---|---|---|---|---|---|
| 1 | `slmm-storage-deletion-t4-live-test.sql` | `test-harness/` | `b56c711aec445ec79ad8f58d0a3b4d9f27116b760b56dfb2a051cbf6d8387d7b` | `e54756b` | permanent |
| 2 | `slmm-storage-deletion-t4-cli-session.sql` | `test-harness/` | `909db27c39f1d642cc5403cb466ea799355da9f3e7a5b33c6bf8b2ab79b5f8e0` | `e54756b` | permanent |
| 3 | `slmm-storage-deletion-t4-residue.sql` | `test-harness/` | `c80509ba37a447108e69edfef6eecc3ce6ac01b32593ea34cdb824a7ede6db4e` | `e54756b` | permanent |

## Raw evidence (external, `%TEMP%`)

Digests of the **raw JSON evidence outputs**, as recorded in
`docs/project/TEST_VERIFICATION_LEDGER.md` ("Raw-evidence SHA-256 (T4 live /
residue)"). These are **not** script hashes and the raw files remain outside Git
(`%TEMP%`), where retention is not guaranteed.

| Evidence | SHA-256 |
|---|---|
| T4 live stdout JSON | `bf5f9440276338fcb2a98d0a1ea591f6f7f9ed47506258e0e2235579bb3dba5d` |
| T4 residue stdout JSON | `4b746375614910d0eeac3a30eb7266dfa760de2989d6ad655e79b4eaadde4d3f` |

## Notes

- No deletion without separate approval.
