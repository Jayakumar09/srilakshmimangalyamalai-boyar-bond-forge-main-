import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const { t, lang } = useI18n();
  const { session, isAdmin } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
        <Link to="/" className="mr-auto flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-primary font-display text-lg text-primary-foreground">
            ஸ்ரீ
          </span>
          <span className="leading-tight">
            <span className="block font-display text-lg font-semibold sm:text-xl">
              {t("brand")}
            </span>
            <span className="block font-display text-xl font-semibold sm:text-2xl">
              Boyar Matrimony
            </span>
          </span>
        </Link>
        <LanguageToggle className="hidden sm:inline-flex" />
        {session ? (
          <>
            {isAdmin ? (
              <>
                <Button asChild variant="ghost" size="sm">
                  <a href={lang === "ta" ? "/tn/admin" : "/en/admin"}>{t("nav_admin")}</a>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/jathagam">{t("jat_page_title")}</Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/matches">{t("nav_matches")}</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/messages" search={{}}>
                    {t("nav_messages")}
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/checkout">{t("nav_payments")}</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <a href={lang === "ta" ? "/ta/support" : "/support"}>{t("sup_title")}</a>
                </Button>
              </>
            )}
            <Button asChild variant="secondary" size="sm">
              <Link to="/dashboard">{t("nav_dashboard")}</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              {t("nav_logout")}
            </Button>
          </>
        ) : (
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to="/auth">{t("nav_login")}</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/auth" search={{ mode: "signup" }}>
                {t("nav_register")}
              </Link>
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
