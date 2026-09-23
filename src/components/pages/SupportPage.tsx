import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { toast } from "sonner";
import { Paperclip, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useSyncChannel, type SyncChannel } from "@/lib/app-sync";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createViewUrl } from "@/lib/storage.functions";
import { uploadToR2, type UploadResult } from "@/lib/upload";

type Channel = "support" | "messages" | "communication";
type Thread = { id: string; subject: string; status: string; last_message_at: string };
type SupportMessage = {
  id: string;
  sender_type: string;
  body: string;
  created_at: string;
  attachment_key: string | null;
  attachment_name: string | null;
};

import { formatIST } from "@/lib/time";

/** Member ↔ office area. Separate from member-to-member matrimonial messaging. */
export function SupportPage({ channel = "support" }: { channel?: Channel }) {
  const { t } = useI18n();
  const [me, setMe] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [subject, setSubject] = useState("");
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const headingKey =
    channel === "communication"
      ? "nav_communication"
      : channel === "messages"
        ? "nav_messages"
        : "sup_title";

  const loadThreads = useCallback(async () => {
    const { data } = await supabase
      .from("support_threads")
      .select("id, subject, status, last_message_at")
      .eq("channel", channel)
      .order("last_message_at", { ascending: false });
    const list = (data ?? []) as Thread[];
    setThreads(list);
    return list;
  }, [channel]);

  const openThread = useCallback(async (id: string) => {
    setActiveId(id);
    const { data } = await supabase
      .from("support_messages")
      .select("id, sender_type, body, created_at, attachment_key, attachment_name")
      .eq("thread_id", id)
      .order("created_at", { ascending: true });
    setMessages((data ?? []) as SupportMessage[]);
    await supabase
      .from("support_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("thread_id", id)
      .eq("sender_type", "admin")
      .is("read_at", null);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setMe(data.user?.id ?? null);
      const list = await loadThreads();
      if (list[0]) await openThread(list[0].id);
      else setActiveId(null);
    });
  }, [loadThreads, openThread]);

  useSyncChannel(channel, () => {
    void loadThreads();
    if (activeId) void openThread(activeId);
  });

  async function startThread() {
    if (!me || !subject.trim()) return;
    const { data, error } = await supabase
      .from("support_threads")
      .insert({ user_id: me, subject: subject.trim().slice(0, 120), channel })
      .select("id")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setSubject("");
    await loadThreads();
    await openThread(data.id);
  }

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadToR2(file, "attachment", me ?? undefined);
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
    if (!me || !activeId) return;
    const body = draft.trim().slice(0, 2000);
    if (!body && !attachment) return;
    setDraft("");
    const sent = attachment;
    setAttachment(null);
    const { error } = await supabase.from("support_messages").insert({
      thread_id: activeId,
      sender_id: me,
      sender_type: "member",
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
    await loadThreads();
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-display text-3xl font-semibold">{t(headingKey)}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("sup_sub")}</p>
        <div className="gold-rule mt-3 w-24" />

        <div className="mt-6 grid gap-5 md:grid-cols-[260px_1fr]">
          <aside className="card-elevated space-y-3 p-3">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("sup_new")}</p>
              <Input
                value={subject}
                placeholder={t("sup_subject")}
                onChange={(e) => setSubject(e.target.value)}
              />
              <Button size="sm" className="w-full" onClick={startThread} disabled={!subject.trim()}>
                {t("sup_start")}
              </Button>
            </div>
            <div className="max-h-[45vh] space-y-1 overflow-y-auto">
              {threads.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-3 text-center">
                  <p className="text-sm font-medium">{t("sup_none")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("sup_none_d")}</p>
                </div>
              )}
              {threads.map((th) => (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => void openThread(th.id)}
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                    th.id === activeId ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  {th.subject}
                </button>
              ))}
            </div>
          </aside>

          <section className="card-elevated flex h-[60vh] flex-col p-4">
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                    m.sender_type === "member"
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
                    {m.sender_type === "member" ? t("sup_you") : t("adm_msg_admin")} ·{" "}
                    {formatIST(m.created_at)}
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
                disabled={!activeId || uploading}
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
                disabled={!activeId}
              />
              <Button
                onClick={send}
                disabled={!activeId || uploading || (!draft.trim() && !attachment)}
              >
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
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
