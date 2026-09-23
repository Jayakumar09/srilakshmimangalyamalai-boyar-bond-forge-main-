import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { toast } from "sonner";
import { Paperclip, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { memberName, useAdminData } from "@/lib/admin-data";
import { statusLabel } from "@/lib/admin-labels";
import { AdminShell } from "@/components/admin/AdminShell";
import { useSyncChannel, type SyncChannel } from "@/lib/app-sync";
import { EmptyState, SectionCard, StatusBadge, toneForStatus } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createViewUrl } from "@/lib/storage.functions";
import { uploadToR2, type UploadResult } from "@/lib/upload";
import { formatIST } from "@/lib/time";

type Channel = "support" | "messages" | "communication";

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
  attachment_key: string | null;
  attachment_name: string | null;
};

export function AdminClientMessages({ channel = "messages" }: { channel?: Channel }) {
  const { t } = useI18n();
  const d = useAdminData();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [me, setMe] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const headingKey =
    channel === "communication"
      ? "adm_nav_communication"
      : channel === "support"
        ? "adm_nav_support"
        : "adm_nav_messages";

  const loadThreads = useCallback(async () => {
    const { data } = await supabase
      .from("support_threads")
      .select("id, user_id, subject, status, last_message_at")
      .eq("channel", channel)
      .order("last_message_at", { ascending: false });
    const list = (data ?? []) as Thread[];
    setThreads(list);
    const { data: unreadRows } = await supabase
      .from("support_messages")
      .select("thread_id")
      .eq("sender_type", "member")
      .is("read_at", null);
    const counts: Record<string, number> = {};
    const threadIds = new Set(list.map((th) => th.id));
    for (const row of unreadRows ?? []) {
      if (!threadIds.has(row.thread_id)) continue;
      counts[row.thread_id] = (counts[row.thread_id] ?? 0) + 1;
    }
    setUnread(counts);
    window.dispatchEvent(new CustomEvent("slmm:admin-messages-refreshed"));
  }, [channel]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    void loadThreads();
  }, [loadThreads]);

  useSyncChannel(channel, () => {
    void loadThreads();
    if (activeId) void openThread(activeId);
  });

  const openThread = useCallback(
    async (id: string) => {
      setActiveId(id);
      const { data } = await supabase
        .from("support_messages")
        .select(
          "id, thread_id, sender_id, sender_type, body, read_at, created_at, attachment_key, attachment_name",
        )
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

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeId) return;
    const owner = threads.find((th) => th.id === activeId)?.user_id;
    if (!owner) return;
    setUploading(true);
    try {
      const result = await uploadToR2(file, "attachment", owner);
      setAttachment(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function openAttachment(key: string) {
    try {
      const { url } = await createViewUrl({ data: { key } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error(t("msg_attach_open_failed"));
    }
  }

  async function send() {
    if (!activeId || !me) return;
    const body = draft.trim().slice(0, 2000);
    if (!body && !attachment) return;
    setDraft("");
    const sent = attachment;
    setAttachment(null);
    const { error } = await supabase.from("support_messages").insert({
      thread_id: activeId,
      sender_id: me,
      sender_type: "admin",
      body,
      attachment_key: sent?.key ?? null,
      attachment_name: sent?.fileName ?? null,
      attachment_mime: sent?.mimeType ?? null,
      attachment_size: sent?.sizeBytes ?? null,
    });
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
    <AdminShell active={channel} title={t(headingKey)} subtitle={t("adm_msg_sub")}>
      {rows.length === 0 && !q ? (
        <EmptyState title={t("adm_msg_empty")} description={t("adm_msg_empty_d")} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <SectionCard title={t(headingKey)}>
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
                    th.id === activeId
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-secondary",
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
                    {t("adm_msg_last_update")}: {formatIST(th.last_message_at)}
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
                  {t("adm_profile_id")}: {activeProfile?.client_profile_id ?? "-"}
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
                      {m.body && <p>{m.body}</p>}
                      {m.attachment_key && (
                        <p className="mt-1 flex items-center gap-1.5">
                          <Paperclip className="size-3 shrink-0" />
                          <span className="max-w-[180px] truncate">{m.attachment_name}</span>
                          <button
                            type="button"
                            onClick={() => void openAttachment(m.attachment_key as string)}
                            className="font-medium underline underline-offset-2"
                            aria-label={t("msg_attach_open")}
                          >
                            {t("msg_attach_view")}
                          </button>
                        </p>
                      )}
                      <p className="mt-1 text-[11px] opacity-70">
                        {m.sender_type === "admin" ? t("adm_msg_admin") : t("adm_member")} ·{" "}
                        {formatIST(m.created_at)}
                        {m.sender_type === "member" && m.read_at ? " · ✓" : ""}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input ref={fileRef} type="file" className="hidden" onChange={pickFile} />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    aria-label={t("msg_attach")}
                    title={t("msg_attach")}
                  >
                    <Paperclip className="size-4" />
                  </Button>
                  <Input
                    value={draft}
                    placeholder={t("adm_msg_reply")}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void send();
                    }}
                  />
                  <Button onClick={send} disabled={uploading || (!draft.trim() && !attachment)}>
                    <Send className="size-4" />
                    <span className="sr-only">{t("adm_msg_send")}</span>
                  </Button>
                </div>
                {uploading && (
                  <p className="mt-1 text-xs text-muted-foreground">{t("uploading_label")}</p>
                )}
                {attachment && !uploading && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Paperclip className="size-3" />
                    <span className="max-w-[240px] truncate">{attachment.fileName}</span>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      className="underline underline-offset-2"
                      aria-label={t("delete")}
                    >
                      ×
                    </button>
                  </p>
                )}
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </AdminShell>
  );
}
