import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { memberName, useAdminData } from "@/lib/admin-data";
import { statusLabel } from "@/lib/admin-labels";
import { AdminShell } from "@/components/admin/AdminShell";
import { EmptyState, SectionCard, StatusBadge, toneForStatus } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Thread = {
  id: string;
  user_id: string;
  subject: string;
  status: string;
  last_message_at: string;
};

type SupportMessage = {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_type: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export function AdminClientMessages() {
  const { t } = useI18n();
  const d = useAdminData();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [me, setMe] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    const { data } = await supabase
      .from("support_threads")
      .select("id, user_id, subject, status, last_message_at")
      .order("last_message_at", { ascending: false });
    const list = (data ?? []) as Thread[];
    setThreads(list);
    const { data: unreadRows } = await supabase
      .from("support_messages")
      .select("thread_id")
      .eq("sender_type", "member")
      .is("read_at", null);
    const counts: Record<string, number> = {};
    for (const row of unreadRows ?? []) {
      counts[row.thread_id] = (counts[row.thread_id] ?? 0) + 1;
    }
    setUnread(counts);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    void loadThreads();
  }, [loadThreads]);

  const openThread = useCallback(
    async (id: string) => {
      setActiveId(id);
      const { data } = await supabase
        .from("support_messages")
        .select("id, thread_id, sender_id, sender_type, body, read_at, created_at")
        .eq("thread_id", id)
        .order("created_at", { ascending: true });
      setMessages((data ?? []) as SupportMessage[]);
      await supabase
        .from("support_messages")
        .update({ read_at: new Date().toISOString() })
        .eq("thread_id", id)
        .eq("sender_type", "member")
        .is("read_at", null);
      await loadThreads();
    },
    [loadThreads],
  );

  async function send() {
    if (!activeId || !draft.trim() || !me) return;
    const body = draft.trim().slice(0, 2000);
    setDraft("");
    const { error } = await supabase
      .from("support_messages")
      .insert({ thread_id: activeId, sender_id: me, sender_type: "admin", body });
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase
      .from("support_threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", activeId);
    await openThread(activeId);
  }

  async function toggleStatus(thread: Thread) {
    await supabase
      .from("support_threads")
      .update({ status: thread.status === "open" ? "closed" : "open" })
      .eq("id", thread.id);
    await loadThreads();
  }

  if (d.allowed === null || !d.allowed) return null;

  const needle = q.trim().toLowerCase();
  const rows = threads.filter((th) => {
    if (!needle) return true;
    return (
      th.subject.toLowerCase().includes(needle) ||
      memberName(d.profiles, th.user_id).toLowerCase().includes(needle)
    );
  });
  const active = threads.find((th) => th.id === activeId) ?? null;
  const activeProfile = active ? d.profiles.find((p) => p.id === active.user_id) : null;

  return (
    <AdminShell active="messages" title={t("adm_nav_messages")} subtitle={t("adm_msg_sub")}>
      {rows.length === 0 && !q ? (
        <EmptyState title={t("adm_msg_empty")} description={t("adm_msg_empty_d")} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <SectionCard title={t("adm_nav_messages")}>
            <Input
              placeholder={t("adm_msg_search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="mt-3 max-h-[55vh] space-y-1 overflow-y-auto">
              {rows.map((th) => (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => void openThread(th.id)}
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                    th.id === activeId ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {memberName(d.profiles, th.user_id)}
                    </span>
                    {unread[th.id] ? (
                      <span className="ml-auto rounded-full bg-destructive px-2 py-0.5 text-[10px] text-destructive-foreground">
                        {unread[th.id]}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs opacity-80">{th.subject}</span>
                  <span className="block text-[11px] opacity-70">
                    {t("adm_msg_last_update")}: {new Date(th.last_message_at).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title={active ? memberName(d.profiles, active.user_id) : t("adm_msg_select")}
            action={
              active && (
                <div className="flex items-center gap-2">
                  <StatusBadge tone={toneForStatus(active.status)}>
                    {statusLabel(t, active.status)}
                  </StatusBadge>
                  <Button size="sm" variant="secondary" onClick={() => void toggleStatus(active)}>
                    {active.status === "open" ? t("adm_msg_close") : t("adm_msg_reopen")}
                  </Button>
                </div>
              )
            }
          >
            {!active ? (
              <p className="text-sm text-muted-foreground">{t("adm_msg_select")}</p>
            ) : (
              <div className="flex h-[55vh] flex-col">
                <p className="text-xs text-muted-foreground">
                  {t("adm_profile_id")}: {active.user_id.slice(0, 8)}
                  {activeProfile?.email ? ` · ${activeProfile.email}` : ""}
                </p>
                <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                        m.sender_type === "admin"
                          ? "ml-auto bg-primary text-primary-foreground"
                          : "bg-secondary",
                      )}
                    >
                      <p>{m.body}</p>
                      <p className="mt-1 text-[11px] opacity-70">
                        {m.sender_type === "admin" ? t("adm_msg_admin") : t("adm_member")} ·{" "}
                        {new Date(m.created_at).toLocaleString()}
                        {m.sender_type === "member" && m.read_at ? " · ✓" : ""}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <Input
                    value={draft}
                    placeholder={t("adm_msg_reply")}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void send();
                    }}
                  />
                  <Button onClick={send} disabled={!draft.trim()}>
                    <Send className="size-4" />
                    <span className="sr-only">{t("adm_msg_send")}</span>
                  </Button>
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </AdminShell>
  );
}
