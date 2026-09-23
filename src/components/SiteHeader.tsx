import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
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
  const location = useLocation();
  const queryClient = useQueryClient();
  const [supportUnread, setSupportUnread] = useState(0);

  const { pathname } = location;
  const supportHref = lang === "ta" ? "/ta/support" : "/support";
  const isSupportActive =
    pathname === supportHref || pathname.startsWith(`${supportHref}/`);
  const isDashboardActive =
    pathname === "/dashboard" || pathname === "/ta/dashboard";

  useEffect(() => {
    if (!session || isAdmin) return;
    let active = true;
    supabase
      .from("support_messages")
      .select("id")
      .eq("sender_type", "admin")
      .is("read_at", null)
      .then(({ data }) => {
        if (active) setSupportUnread(data?.length ?? 0);
      });
    return () => {
      active = false;
    };
  }, [session, isAdmin]);

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
            {t("brand_badge")}
          </span>
          <span className="leading-tight">
            <span className="block font-display text-2xl font-semibold sm:text-3xl">
              {t("brand")}
            </span>
            <span className="block font-display text-xl font-semibold sm:text-2xl">
              {t("brand_line2")}
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
                <Button asChild variant={pathname === "/matches" ? "secondary" : "ghost"} size="sm">
                  <Link to="/matches">{t("nav_matches")}</Link>
                </Button>
                <Button asChild variant={pathname === "/messages" ? "secondary" : "ghost"} size="sm">
                  <Link to="/messages" search={{}}>
                    {t("nav_messages")}
                  </Link>
                </Button>
                <Button asChild variant={pathname === "/checkout" ? "secondary" : "ghost"} size="sm">
                  <Link to="/checkout">{t("nav_payments")}</Link>
                </Button>
                <Button asChild variant={isSupportActive ? "secondary" : "ghost"} size="sm">
                  <a
                    href={supportHref}
                    className="inline-flex items-center gap-1.5"
                  >
                    {t("sup_title")}
                    {supportUnread > 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary">
                        {supportUnread > 99 ? "99+" : supportUnread}
                      </span>
                    )}
                  </a>
                </Button>
              </>
            )}
            <Button asChild variant={isDashboardActive ? "secondary" : "ghost"} size="sm">
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
