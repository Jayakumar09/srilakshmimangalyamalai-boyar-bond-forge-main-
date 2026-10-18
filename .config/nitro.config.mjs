// .config/nitro.config.mjs
//
// Project-level Nitro configuration. Nitro loads this file on its own (via
// c12) during every `vite build` / `vite dev`; the Lovable TanStack config
// wrapper does NOT inject Cloudflare options outside a Lovable sandbox, so this
// is the isolated place for project-level Nitro overrides.
//
// PURPOSE — TEST isolation only
// -----------------------------
// Nitro's `cloudflare-module` preset writes `.output/server/wrangler.json` and
// derives its `name` from the production `wrangler.toml`. Under the TEST build
// only, this file pins the TEST Worker name so the generated deploy config
// targets the TEST Worker.
//
// Source of truth (nitro/dist/_presets.mjs -> writeWranglerConfig):
//     wranglerConfig = defu(overrides, nitro.options.cloudflare.wrangler,
//                           wrangler.toml, defaults)
// `nitro.options.cloudflare.wrangler` (ctxConfig) takes precedence over
// `wrangler.toml`, so setting only `name` overrides just the Worker name; every
// other generated field (main, assets, compatibility_date, compatibility_flags,
// no_bundle, rules) is preserved and Nitro defaults are untouched.
//
// FAIL-CLOSED
// -----------
// The override activates ONLY when the build is explicitly the TEST build:
//   * `npm run build:test`  ->  npm exposes npm_lifecycle_event="build:test"
//   * or an explicit SLMM_BUILD_TARGET="test"
// For every production/default build this module returns an empty object, so
// the override does not activate and Nitro falls back to `wrangler.toml`
// (production Worker name unchanged).
//
// PURPOSE — TEST-only storage-deletion schedule
// ---------------------------------------------
// The TEST build additionally:
//   * installs the Cloudflare cron trigger for the storage-deletion scheduler,
//   * registers the Nitro plugin that answers that trigger.
// Both are TEST-only, so a production build schedules no cron, bundles no
// scheduler/guard module, and keeps `.output/server/wrangler.json` identical to
// before (no `triggers`). The schedule and the batch limit are single literals:
//   "*/15 * * * *"  every 15 minutes.
// The scheduler module owns the same cron literal (`SCHEDULER_CRON`) and rejects
// any event it did not schedule; an offline suite pins the two together so
// neither can drift.
//
// WHY NOT NITRO TASKS (`experimental.tasks` + `scheduledTasks`)
// ------------------------------------------------------------
// That path pulls in `#nitro/runtime/task`, which statically imports `croner`.
// `croner` is only a devDependency of the installed Nitro beta and is absent
// from `node_modules`, while the Cloudflare worker build bundles every
// dependency, so enabling tasks fails the build. The generated Cloudflare
// handler already calls the `cloudflare:scheduled` runtime hook on every
// scheduled event, so this file registers the plugin directly and needs no task
// runtime.
//
// This file contains no secrets and no environment/resource bindings.

import { fileURLToPath } from "node:url";

/** Every-15-minutes trigger. Mirrors `SCHEDULER_CRON` in src/lib/storage-scheduler.ts. */
const STORAGE_SCHEDULER_CRON = "*/15 * * * *";

/** TEST-only Nitro plugin that runs the scheduler on the trigger above. */
const storageSchedulerPlugin = fileURLToPath(
  new URL("../src/lib/storage-scheduler-plugin.ts", import.meta.url),
);

const isTestBuild =
  process.env.npm_lifecycle_event === "build:test" ||
  process.env.SLMM_BUILD_TARGET === "test";

export default isTestBuild
  ? {
      cloudflare: {
        wrangler: {
          name: "slmm-boyar-matrimony-test",
          triggers: { crons: [STORAGE_SCHEDULER_CRON] },
        },
      },
      plugins: [storageSchedulerPlugin],
    }
  : {};
