import { getRequest } from "@tanstack/react-start/server";

type WaitUntilFn = (promise: Promise<unknown>) => void;
type WaitableRequest = Request & { waitUntil?: WaitUntilFn };

/**
 * Returns the Cloudflare Worker `waitUntil` hook for the current request when
 * the runtime provides one.
 *
 * Nitro's Cloudflare handler attaches `waitUntil` to the request object before
 * dispatching (nitro/dist/presets/cloudflare/runtime/_module-handler.mjs) and
 * TanStack Start exposes that same request through `getRequest()`, so no new
 * context plumbing is required. Returns `undefined` on runtimes without a
 * Worker execution context (for example local dev).
 */
export function getWaitUntil(): WaitUntilFn | undefined {
  try {
    const request = getRequest() as WaitableRequest | undefined;
    const waitUntil = request?.waitUntil;
    return typeof waitUntil === "function" ? waitUntil.bind(request) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs downstream delivery work without letting the runtime drop it when the
 * response is returned.
 *
 * - With `waitUntil` available the task is registered with the Worker
 *   lifecycle and this resolves immediately: the response does not wait for
 *   delivery, and the runtime keeps the invocation alive until the task
 *   settles. If registration itself throws, the failure is logged and the task
 *   is awaited inline so the work is not dropped and the response is not
 *   falsely reported as a failed verification.
 * - Without it (local dev / tests) the task is awaited inline so it is never
 *   silently lost; the response is only sent once the work finishes.
 *
 * The task's rejection is swallowed (and logged through the shared
 * console.error convention) so a delivery failure can never surface as a
 * failed payment verification.
 */
export async function runBackgroundTask(task: () => Promise<unknown>): Promise<void> {
  const waitUntil = getWaitUntil();
  const promise = Promise.resolve()
    .then(task)
    .catch((error: unknown) => {
      console.error("[background-task] task failed", error);
    });
  if (waitUntil) {
    try {
      waitUntil(promise);
      return;
    } catch (error) {
      console.error("[background-task] waitUntil registration failed; awaiting inline", error);
    }
  }
  await promise;
}
