import { useEffect, useRef } from "react";
import type { MutableRefObject, PropsWithChildren } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SyncChannel = "support" | "messages" | "communication";
export type RefreshFn = () => void | Promise<void>;

type Registered = {
  channel: SyncChannel;
  refreshRef: MutableRefObject<RefreshFn>;
};

const subscribers = new Set<Registered>();

function dispatchToChannel(channel: SyncChannel) {
  window.dispatchEvent(new CustomEvent("slmm:app-sync-changed", { detail: { channel } }));
  for (const sub of subscribers) {
    if (sub.channel !== channel) continue;
    void Promise.resolve(sub.refreshRef.current()).catch(() => {});
  }
}

function syncAll() {
  window.dispatchEvent(new CustomEvent("slmm:app-sync-changed", { detail: { channel: "all" } }));
  for (const sub of subscribers) {
    void Promise.resolve(sub.refreshRef.current()).catch(() => {});
  }
}

/**
 * Registers this page's refresher for a single office channel. Registration
 * lives only while the page/mounted, so dispatch is naturally route-aware:
 * an INSERT to one channel refreshes exactly the pages currently on screen
 * for that channel (client Support / office Messages / Communication, and
 * the matching admin list) — never every table.
 */
export function useSyncChannel(channel: SyncChannel, refresh: RefreshFn) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const entry: Registered = { channel, refreshRef };
    subscribers.add(entry);
    return () => {
      subscribers.delete(entry);
    };
  }, [channel]);
}

/**
 * Single application-level sync owner. Mounted once in the authenticated
 * layout. Owns:
 *  - ONE realtime channel ("app-sync") on support_messages INSERT (primary)
 *  - ONE global 60-second safety-net interval
 *  - Page Visibility: no sync work while the tab is hidden; an immediate
 *    sync runs the moment the user returns to the tab.
 * Overlapping sync calls are prevented with a shared in-flight guard.
 */
export function AppSyncProvider({ children }: PropsWithChildren) {
  const busyRef = useRef(false);

  useEffect(() => {
    const isVisible = () => document.visibilityState === "visible";

    const runSync = () => {
      if (busyRef.current) return;
      busyRef.current = true;
      void (async () => {
        try {
          syncAll();
        } finally {
          busyRef.current = false;
        }
      })();
    };

    const channel = supabase
      .channel("app-sync")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages" },
        async (payload) => {
          const row = (payload.new ?? {}) as { thread_id?: string };
          if (!row.thread_id) return;
          const { data } = await supabase
            .from("support_threads")
            .select("channel")
            .eq("id", row.thread_id)
            .maybeSingle();
          if (data?.channel) {
            runSync();
            dispatchToChannel(data.channel as SyncChannel);
          }
        },
      )
      .subscribe();

    const timer = window.setInterval(() => {
      runSync();
    }, 60_000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        runSync();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      void supabase.removeChannel(channel);
    };
  }, []);

  return <>{children}</>;
}
