# ARTIFACT MANIFEST — <TASK-ID>

> Every artifact the task produced or depends on, with checksums. Disposable
> working files must be listed here before any deletion is proposed.

- **Task:** `<TASK-ID>`
- **Baseline HEAD:** `<sha>`

## Artifacts

| # | Source filename | Destination / location | SHA-256 | Committed Git path | Commit | Status | Retention |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |

**Column meanings**

- **Source filename** — original name/path of the artifact.
- **Destination / location** — where it lives now (repo path, or external such as `%TEMP%`).
- **SHA-256** — lowercase hex digest.
- **Committed Git path** — path inside the repo if tracked, else `untracked` / `external`.
- **Commit** — commit SHA that introduced it, else `—`.
- **Status** — `permanent` | `disposable` | `external-ephemeral`.
- **Retention** — why it is kept, or the condition under which it may be deleted.

## Notes

- Nothing here may be deleted without separate explicit approval (see `project-tasks/README.md` rule 9).
