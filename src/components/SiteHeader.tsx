import { useCallback, useEffect, useState } from "react";
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
  const [channelUnread, setChannelUnread] = useState<Record<string, number>>({});

  const { pathname } = location;
  const supportHref = lang === "ta" ? "/ta/support" : "/support";
  const officeHref = lang === "ta" ? "/ta/office-messages" : "/office-messages";
  const communicationHref = lang === "ta" ? "/ta/communication" : "/communication";
  const isSupportActive = pathname === supportHref || pathname.startsWith(`${supportHref}/`);
  const isOfficeActive = pathname === officeHref || pathname.startsWith(`${officeHref}/`);
  const isCommunicationActive =
    pathname === communicationHref || pathname.startsWith(`${communicationHref}/`);
  const isDashboardActive = pathname === "/dashboard" || pathname === "/ta/dashboard";

  const loadUnread = useCallback(async () => {
    if (!session || isAdmin) return;
    let active = true;
    await supabase
      .from("support_messages")
      .select("thread_id")
      .eq("sender_type", "admin")
      .is("read_at", null)
      .then(async ({ data }) => {
        const rowCounts: Record<string, number> = {};
        for (const row of data ?? []) {
          rowCounts[row.thread_id] = (rowCounts[row.thread_id] ?? 0) + 1;
        }
        const ids = Object.keys(rowCounts);
        const counts: Record<string, number> = { support: 0, messages: 0, communication: 0 };
        if (ids.length) {
          const { data: threads } = await supabase
            .from("support_threads")
            .select("id, channel")
            .in("id", ids);
          for (const th of threads ?? []) {
            const n = rowCounts[th.id];
            if (n) counts[th.channel] = (counts[th.channel] ?? 0) + n;
          }
        }
        if (active) setChannelUnread(counts);
      });
    active = false;
  }, [session, isAdmin]);

  useEffect(() => {
    void loadUnread();
    const onSync = () => void loadUnread();
    window.addEventListener("slmm:app-sync-changed", onSync);
    return () => {
      window.removeEventListener("slmm:app-sync-changed", onSync);
    };
  }, [loadUnread]);

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
                    {t("nav_member_messages")}
                  </Link>
                </Button>
                <Button asChild variant={pathname === "/checkout" ? "secondary" : "ghost"} size="sm">
                  <Link to="/checkout">{t("nav_payments")}</Link>
                </Button>
                <Button asChild variant={isSupportActive ? "secondary" : "ghost"} size="sm">
                  <a href={supportHref} className="inline-flex items-center gap-1.5">
                    {t("sup_title")}
                    {(channelUnread["support"] ?? 0) > 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary">
                        {(channelUnread["support"] ?? 0) > 99
                          ? "99+"
                          : (channelUnread["support"] ?? 0)}
                      </span>
                    )}
                  </a>
                </Button>
                <Button asChild variant={isOfficeActive ? "secondary" : "ghost"} size="sm">
                  <a href={officeHref} className="inline-flex items-center gap-1.5">
                    {t("nav_messages")}
                    {(channelUnread["messages"] ?? 0) > 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary">
                        {(channelUnread["messages"] ?? 0) > 99
                          ? "99+"
                          : (channelUnread["messages"] ?? 0)}
                      </span>
                    )}
                  </a>
                </Button>
                <Button asChild variant={isCommunicationActive ? "secondary" : "ghost"} size="sm">
                  <a href={communicationHref} className="inline-flex items-center gap-1.5">
                    {t("nav_communication")}
                    {(channelUnread["communication"] ?? 0) > 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary">
                        {(channelUnread["communication"] ?? 0) > 99
                          ? "99+"
                          : (channelUnread["communication"] ?? 0)}
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
