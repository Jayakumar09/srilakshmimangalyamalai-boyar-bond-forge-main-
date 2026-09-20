import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ mode: z.enum(["signin", "signup"]).optional() }),
  head: () => ({
    meta: [
      { title: "Member sign in — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content: "Sign in or create your Boyar community matrimony account.",
      },
      { property: "og:title", content: "Member sign in — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Sign in or create your matrimony account." },
    ],
  }),
  component: AuthPage,
});

const schema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(72),
  fullName: z.string().trim().max(100).optional(),
});

function AuthPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">(search.mode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password, fullName });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check your details");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: parsed.data.fullName ?? "" },
          },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Please check your email to confirm your account.");
          return;
        }
        navigate({ to: "/register" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email.trim()) {
      toast.error(t("auth_forgot_missing_email"));
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success(t("auth_forgot_sent"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto flex max-w-md flex-col px-4 py-14">
        <h1 className="font-display text-3xl font-semibold">
          {mode === "signin" ? t("auth_title") : t("auth_signup")}
        </h1>
        <div className="gold-rule mt-4 w-24" />
        <form onSubmit={submit} className="card-elevated mt-6 space-y-4 p-6">
          {mode === "signup" && (
            <div>
              <Label htmlFor="name">{t("full_name")}</Label>
              <Input
                id="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1.5"
                maxLength={100}
              />
            </div>
          )}
          <div>
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5"
              required
            />
          </div>
          <div>
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5"
              minLength={8}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "signin" ? t("nav_login") : t("nav_register")}
          </Button>
          {mode === "signin" && (
            <button
              type="button"
              className="w-full text-right text-sm text-muted-foreground hover:text-foreground"
              disabled={busy}
              onClick={forgot}
            >
              {t("auth_forgot")}
            </button>
          )}
          <button
            type="button"
            className="w-full text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? t("no_account") : t("have_account")}
          </button>
          <p className="text-center text-xs text-muted-foreground">
            <Link to="/terms" className="underline">
              {t("terms")}
            </Link>{" "}
            ·{" "}
            <Link to="/privacy" className="underline">
              {t("privacy")}
            </Link>
          </p>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}
