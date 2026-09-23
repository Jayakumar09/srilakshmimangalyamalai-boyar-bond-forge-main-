import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Thread = { id: string; subject: string; status: string; last_message_at: string };
type SupportMessage = {
  id: string;
  sender_type: string;
  body: string;
  created_at: string;
};

/** Formats a UTC timestamp for display in India time (Asia/Kolkata). */
function istTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(iso))
    .replace(/\b(am|pm)\b/gi, (m) => m.toUpperCase());
}

/** Member ↔ office support area. Separate from member-to-member matrimonial messaging. */
export function SupportPage() {
  const { t } = useI18n();
  const [me, setMe] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [subject, setSubject] = useState("");
  const [draft, setDraft] = useState("");

  const loadThreads = useCallback(async () => {
    const { data } = await supabase
      .from("support_threads")
      .select("id, subject, status, last_message_at")
      .order("last_message_at", { ascending: false });
    const list = (data ?? []) as Thread[];
    setThreads(list);
    return list;
  }, []);

  const openThread = useCallback(async (id: string) => {
    setActiveId(id);
    const { data } = await supabase
      .from("support_messages")
      .select("id, sender_type, body, created_at")
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
    });
  }, [loadThreads, openThread]);

  async function startThread() {
    if (!me || !subject.trim()) return;
    const { data, error } = await supabase
      .from("support_threads")
      .insert({ user_id: me, subject: subject.trim().slice(0, 120) })
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

  async function send() {
    if (!me || !activeId || !draft.trim()) return;
    const body = draft.trim().slice(0, 2000);
    setDraft("");
    const { error } = await supabase
      .from("support_messages")
      .insert({ thread_id: activeId, sender_id: me, sender_type: "member", body });
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
        <h1 className="font-display text-3xl font-semibold">{t("sup_title")}</h1>
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
                  <p>{m.body}</p>
                  <p className="mt-1 text-[11px] opacity-70">
                    {m.sender_type === "member" ? t("sup_you") : t("adm_msg_admin")} ·{" "}
                    {istTimestamp(m.created_at)}
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
                disabled={!activeId}
              />
              <Button onClick={send} disabled={!activeId || !draft.trim()}>
                <Send className="size-4" />
                <span className="sr-only">{t("adm_msg_send")}</span>
              </Button>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
