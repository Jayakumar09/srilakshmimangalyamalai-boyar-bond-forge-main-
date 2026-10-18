/**
 * Nitro plugin that answers Cloudflare's `scheduled` event for the
 * storage-deletion scheduler.
 *
 * WHY A HOOK AND NOT A NITRO TASK
 * -------------------------------
 * Nitro's `experimental.tasks` + `scheduledTasks` path pulls in
 * `#nitro/runtime/task`, whose module statically imports `croner`. `croner` is
 * only a devDependency of the installed Nitro beta, so it is not present in
 * `node_modules` here, and the Cloudflare worker build bundles every dependency
 * (`noExternals: true`). Turning tasks on would therefore break the build (or
 * ship an unresolvable import, since the generated wrangler config sets
 * `no_bundle: true`).
 *
 * The generated Cloudflare handler already calls the `cloudflare:scheduled`
 * Nitro runtime hook for every scheduled event, unconditionally, with no
 * dependency beyond what is already bundled. This plugin registers that hook,
 * so no task runtime is needed.
 *
 * The cron trigger itself is installed by `.config/nitro.config.mjs` in the TEST
 * build only. This plugin is registered only in that same TEST branch, so a
 * production build neither schedules the event nor bundles this module.
 *
 * BINDINGS ONLY
 * -------------
 * The event's `env` is the ONLY configuration source for a scheduled run.
 * `collectSchedulerBindings` projects it without ever consulting
 * `process.env`, so a missing, incomplete or empty binding set reaches the
 * guard incomplete and is refused there -- before the deletion processor, any
 * privileged RPC, any R2 DELETE or any quota write can run -- instead of being
 * silently completed with unrelated ambient credentials. The guard validates
 * exactly the view that is then handed to the processor.
 */
import { collectSchedulerBindings, runStorageDeletionScheduler, SCHEDULER_CRON } from "./storage-scheduler";

type ScheduledEvent = {
  controller?: { cron?: string } | null;
  env?: Record<string, string | undefined> | null;
};

type NitroAppLike = {
  hooks: {
    hook: (name: string, handler: (event: ScheduledEvent) => unknown) => unknown;
  };
};

export default function storageSchedulerPlugin(nitroApp: NitroAppLike): void {
  nitroApp.hooks.hook("cloudflare:scheduled", async (event) => {
    const cron = typeof event?.controller?.cron === "string" ? event.controller.cron : null;
    // Cheap pre-filter; runStorageDeletionScheduler re-checks the cron itself so
    // the guarantee does not depend on this call site.
    if (cron !== SCHEDULER_CRON) return;
    await runStorageDeletionScheduler({
      cron,
      env: collectSchedulerBindings(event?.env ?? undefined),
    });
  });
}
