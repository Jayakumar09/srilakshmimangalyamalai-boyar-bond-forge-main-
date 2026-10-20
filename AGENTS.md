# Repository Guidelines

This project is self-hosted and is **not** connected to Lovable. Do not reconnect
Lovable, and do not use Lovable for builds, previews, publishing, or deployment.

- **Build:** `npm run build` (Vite + TanStack Start; Cloudflare Workers output).
- **Typecheck:** `npx tsc --noEmit`.
- **Deployment:** Cloudflare Workers. Deployment targets, Worker names, account
  IDs, and exact deploy commands are **pending verification** — do not invent or
  assume them.
- Preserve published git history: do not force-push, rebase, amend, or squash
  commits that are already pushed.
- **Session start (required):** before any new project operation, read
  `docs/project/CURRENT_HANDOVER.md`, then `docs/project/TASK_INDEX.md`, then the
  active task folder under `project-tasks/`. Recover state from repository files,
  not chat history; follow `PROJECT_STATUS.md` §8 (TEST-only, binding).
