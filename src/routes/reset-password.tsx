import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset your password — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content: "Choose a new password for your Sri Lakshmi Mangalya Malai account.",
      },
      { property: "og:title", content: "Reset your password — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Choose a new password for your account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) setState((s) => (s === "checking" ? "invalid" : s));
    }, 3000);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && active) setState("ready");
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session?.user) setState("ready");
    });
    return () => {
      active = false;
      window.clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8 || password !== confirm) {
      toast.error(t("reset_pwds_mismatch"));
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success(t("reset_success"));
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("reset_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto flex max-w-md flex-col px-4 py-14">
        <h1 className="font-display text-3xl font-semibold">{t("reset_title")}</h1>
        <div className="gold-rule mt-4 w-24" />
        {state === "checking" && <p className="mt-6 text-sm text-muted-foreground">…</p>}
        {state === "invalid" && (
          <div className="card-elevated mt-6 space-y-4 p-6">
            <p className="text-sm text-muted-foreground">{t("reset_invalid")}</p>
            <Button asChild className="w-full">
              <a href="/auth">{t("reset_back")}</a>
            </Button>
          </div>
        )}
        {state === "ready" && (
          <form onSubmit={submit} className="card-elevated mt-6 space-y-4 p-6">
            <p className="text-sm text-muted-foreground">{t("reset_hint")}</p>
            <div>
              <Label htmlFor="new-password">{t("reset_new_password")}</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5"
                minLength={8}
                autoComplete="new-password"
                required
              />
            </div>
            <div>
              <Label htmlFor="confirm-password">{t("reset_confirm_password")}</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1.5"
                minLength={8}
                autoComplete="new-password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {t("reset_submit")}
            </Button>
          </form>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
