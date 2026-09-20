import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/messages")({
  validateSearch: z.object({ c: z.string().uuid().optional() }),
  head: () => ({
    meta: [
      { title: "Messages — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content: "Private conversations between approved members on Standard and Premium plans.",
      },
      { property: "og:title", content: "Messages — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Private member conversations." },
    ],
  }),
  component: Messages,
});

type Conversation = { id: string; user_a: string; user_b: string; last_message_at: string };
type Message = { id: string; sender_id: string; body: string; created_at: string };

function Messages() {
  const { t } = useI18n();
  const { c } = Route.useSearch();
  const navigate = useNavigate();
  const [me, setMe] = useState<string | null>(null);
  const [plan, setPlan] = useState<string>("free");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeId = c ?? conversations[0]?.id ?? null;

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setMe(data.user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("membership_plan")
        .eq("id", data.user.id)
        .maybeSingle();
      if (profile) setPlan(profile.membership_plan);

      const { data: convos } = await supabase
        .from("conversations")
        .select("id, user_a, user_b, last_message_at")
        .order("last_message_at", { ascending: false });
      const list = (convos ?? []) as Conversation[];
      setConversations(list);

      const otherIds = list.map((x) => (x.user_a === data.user.id ? x.user_b : x.user_a));
      if (otherIds.length) {
        const { data: people } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", otherIds);
        const map: Record<string, string> = {};
        for (const p of people ?? []) map[p.id] = p.full_name ?? "Member";
        setNames(map);
      }
    });
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    const { data } = await supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    setMessages((data ?? []) as Message[]);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    void loadMessages(activeId);
    const channel = supabase
      .channel(`messages-${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${activeId}`,
        },
        (payload) => {
          setMessages((m) => [...m, payload.new as Message]);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!me || !activeId || !draft.trim()) return;
    const body = draft.trim().slice(0, 2000);
    setDraft("");
    const { error } = await supabase
      .from("messages")
      .insert({ conversation_id: activeId, sender_id: me, body });
    if (error) {
      toast.error(
        error.message.includes("policy") ? t("upgrade_to_message") : error.message,
      );
      return;
    }
    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", activeId);
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-display text-3xl font-semibold">{t("messages_title")}</h1>
        <div className="gold-rule mt-3 w-24" />
        {plan === "free" && (
          <p className="mt-4 rounded-lg border border-border bg-secondary/50 p-4 text-sm">
            {t("upgrade_to_message")}
          </p>
        )}

        <div className="mt-6 grid gap-5 md:grid-cols-[260px_1fr]">
          <aside className="card-elevated max-h-[60vh] overflow-y-auto p-2">
            {conversations.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">{t("no_conversations")}</p>
            )}
            {conversations.map((conv) => {
              const other = conv.user_a === me ? conv.user_b : conv.user_a;
              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => navigate({ to: "/messages", search: { c: conv.id } })}
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                    conv.id === activeId ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  {names[other] ?? "Member"}
                </button>
              );
            })}
          </aside>

          <section className="card-elevated flex h-[60vh] flex-col p-4">
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                    m.sender_id === me
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "bg-secondary",
                  )}
                >
                  {m.body}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <div className="mt-3 flex gap-2">
              <Input
                value={draft}
                placeholder={t("type_message")}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void send();
                }}
                disabled={!activeId}
              />
              <Button onClick={send} disabled={!activeId || !draft.trim()}>
                <Send className="size-4" />
                <span className="sr-only">{t("send")}</span>
              </Button>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
