import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { authRedirectOrigin } from "@/lib/auth-redirect";
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
  const { t, lang } = useI18n();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">(search.mode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const redirectAfterAuth = useCallback(
    async (userId: string) => {
      const { data: adminRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      navigate({
        to: adminRow ? (lang === "ta" ? "/tn/admin" : "/en/admin") : "/dashboard",
        replace: true,
      });
    },
    [navigate, lang],
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) redirectAfterAuth(data.session.user.id);
    });
  }, [redirectAfterAuth]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password, fullName });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("auth_invalid"));
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: authRedirectOrigin(),
            data: { full_name: parsed.data.fullName ?? "" },
          },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success(t("auth_confirm_email"));
          return;
        }
        navigate({ to: "/register" });
      } else {
        const { data: signInData, error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) throw error;
        await redirectAfterAuth(signInData.user.id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("msg_something_wrong"));
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
        redirectTo: `${authRedirectOrigin()}/reset-password`,
      });
      if (error) throw error;
      toast.success(t("auth_forgot_sent"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("msg_something_wrong"));
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
            <div className="relative mt-1.5">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
                minLength={8}
                required
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
              <button
                type="button"
                aria-label={showPassword ? t("hide_password") : t("show_password")}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center justify-center pr-3 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
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
