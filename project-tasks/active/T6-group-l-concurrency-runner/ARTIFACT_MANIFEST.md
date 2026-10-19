# ARTIFACT MANIFEST — T6

- **Task:** `T6`
- **Baseline HEAD:** `eef9b2e607346f3560af5baf1f170932455a9b44`

All T6 artifacts currently live in the **external, ephemeral** directory
`%TEMP%\opencode\t6-prep` and are **not tracked by Git**. Hashes below were
re-verified 2026-10-19.

| # | Source filename | Destination / location | SHA-256 | Committed Git path | Commit | Status | Retention |
|---|---|---|---|---|---|---|---|
| 1 | `t6-local-runner.mjs` | `%TEMP%\opencode\t6-prep\` | `e1719be2ac0d432c903035001fdb0774c93641c0fa308073eefcf55e699aa234` | untracked (external) | — | external-ephemeral | approved runner; preserve until task closes |
| 2 | `t6-runner.ps1` | `%TEMP%\opencode\t6-prep\` | `abd83227a98a40943666f2c6a3e07a5247d0f7ee8838435ce02b00f2b0c6701b` | untracked (external) | — | external-ephemeral | **hash mismatch** — resolve before execution |
| 3 | `t6-case-matrix.json` | `%TEMP%\opencode\t6-prep\` | `db689dc37b67d1a49bb1c62f0db5e7dc4c43bdea86e476a8be9037ae540a3a69` | untracked (external) | — | external-ephemeral | case definitions |
| 4 | `t6-lab-setup.sql` | `%TEMP%\opencode\t6-prep\` | `1d4ea1f4e5cdbf7ef64da5b5ebdedc0a73f0b86e5bcc199c36eab4ebaa7655ee` | untracked (external) | — | external-ephemeral | lab schema |
| 5 | `t6-lab-residue.sql` | `%TEMP%\opencode\t6-prep\` | `0ff0682e7c1d981955e513fe30876057eb9bcffbcb17a9d7ca562338e7073898` | untracked (external) | — | external-ephemeral | residue check |
| 6 | `t6-preflight-lab.sql` | `%TEMP%\opencode\t6-prep\` | `3dd5959f6baf3ae2873790f6dd227b8737a836f59cbd75cf21e12937ddbb9766` | untracked (external) | — | external-ephemeral | preflight |
| 7 | `t6-sync.sql` | `%TEMP%\opencode\t6-prep\` | `3415b649f8a7dd0fd16b990b096a712602fa10ba78ad85eaf04575347fa2ccc5` | untracked (external) | — | external-ephemeral | sync step |
| 8 | `slmm-storage-deletion-t6-residue.sql` | `%TEMP%\opencode\t6-prep\` | `66edf661e1d70a935eee793ed0d24e0b245d5af78dc8d36fb81200cf534cd92e` | untracked (external) | — | external-ephemeral | residue (storage-deletion) |
| 9 | `T6_PREPARATION_PLAN.md` | `%TEMP%\opencode\t6-prep\` | `d24810f9b0947d74ee35544cf18fe468adb8bef202676b938309b1c265e22a3b` | untracked (external) | — | external-ephemeral | design record |
| 10 | `T6_LAB_DESIGN.md` | `%TEMP%\opencode\t6-prep\` | `057ea3fa8e73132061efacb90e2d7c6660d2a8326933d8a572eb5f757a5d7add` | untracked (external) | — | external-ephemeral | design record |
| 11 | `T6_LAB_IMPLEMENTATION_PLAN.md` | `%TEMP%\opencode\t6-prep\` | `945ac2e88cd950ca35f8988440f4b879c0321b25aacd7e78bed8595173718ffe` | untracked (external) | — | external-ephemeral | design record |

## Related external state (not files)

| Item | Location | Note |
|---|---|---|
| Existing local PostgreSQL cluster | `127.0.0.1:15432`, PID 2676 | `-D %TEMP%\opencode\t6lab\data`. **Left running, untouched.** |
| Disposable lab directory | `%TEMP%\opencode\t6lab` | Pre-existing; `T6LAB_OWNER` run=`3717dbce…`, pid=`5480`. **Left in place, untouched.** |

## Notes

- Because these files are in ephemeral `%TEMP%`, **preserve them into the task
  folder before task closure** — but only with explicit approval (rule 9/10).
- Nothing here may be deleted or overwritten without separate explicit approval.
