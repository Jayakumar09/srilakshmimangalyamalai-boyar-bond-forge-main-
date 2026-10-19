# Active & Blocked Tasks

Tasks currently being worked, or blocked pending an explicit unblock.

- `ACTIVE` — verification in progress.
- `BLOCKED` — started but cannot proceed until a prerequisite is met.

Create each task as its own folder: `active/<TASK-ID>-<kebab-title>/` with
`TASK.md`, `PROGRESS.md`, `TEST_REPORT.md`, `ARTIFACT_MANIFEST.md`
(copy from `../_TEMPLATE/`).

When a task is committed, pushed and verified on GitHub, archive it to
`../completed/`.
