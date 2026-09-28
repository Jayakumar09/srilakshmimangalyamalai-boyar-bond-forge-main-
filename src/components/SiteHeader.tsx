import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Menu, X } from "lucide-react";
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
  const [menuOpen, setMenuOpen] = useState(false);

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

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const unreadBadge = (count: number | undefined) =>
    (count ?? 0) > 0 ? (
      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary">
        {(count ?? 0) > 99 ? "99+" : count}
      </span>
    ) : null;

  const renderNav = (itemClass?: string) => (
    <>
      {session ? (
        <>
          {isAdmin ? (
            <>
              <Button asChild variant="ghost" size="sm" className={itemClass}>
                <a href={lang === "ta" ? "/tn/admin" : "/en/admin"} onClick={closeMenu}>
                  {t("nav_admin")}
                </a>
              </Button>
              <Button asChild variant="ghost" size="sm" className={itemClass}>
                <Link to="/jathagam" onClick={closeMenu}>
                  {t("jat_page_title")}
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button
                asChild
                variant={pathname === "/matches" ? "secondary" : "ghost"}
                size="sm"
                className={itemClass}
              >
                <Link to="/matches" onClick={closeMenu}>
                  {t("nav_matches")}
                </Link>
              </Button>
              <Button
                asChild
                variant={pathname === "/messages" ? "secondary" : "ghost"}
                size="sm"
                className={itemClass}
              >
                <Link to="/messages" search={{}} onClick={closeMenu}>
                  {t("nav_member_messages")}
                </Link>
              </Button>
              <Button
                asChild
                variant={pathname === "/checkout" ? "secondary" : "ghost"}
                size="sm"
                className={itemClass}
              >
                <Link to="/checkout" onClick={closeMenu}>
                  {t("nav_payments")}
                </Link>
              </Button>
              <Button
                asChild
                variant={isSupportActive ? "secondary" : "ghost"}
                size="sm"
                className={itemClass}
              >
                <a
                  href={supportHref}
                  className="inline-flex items-center gap-1.5"
                  onClick={closeMenu}
                >
                  {t("sup_title")}
                  {unreadBadge(channelUnread["support"])}
                </a>
              </Button>
              <Button
                asChild
                variant={isOfficeActive ? "secondary" : "ghost"}
                size="sm"
                className={itemClass}
              >
                <a
                  href={officeHref}
                  className="inline-flex items-center gap-1.5"
                  onClick={closeMenu}
                >
                  {t("nav_messages")}
                  {unreadBadge(channelUnread["messages"])}
                </a>
              </Button>
              <Button
                asChild
                variant={isCommunicationActive ? "secondary" : "ghost"}
                size="sm"
                className={itemClass}
              >
                <a
                  href={communicationHref}
                  className="inline-flex items-center gap-1.5"
                  onClick={closeMenu}
                >
                  {t("nav_communication")}
                  {unreadBadge(channelUnread["communication"])}
                </a>
              </Button>
            </>
          )}
          <Button
            asChild
            variant={isDashboardActive ? "secondary" : "ghost"}
            size="sm"
            className={itemClass}
          >
            <Link to="/dashboard" onClick={closeMenu}>
              {t("nav_dashboard")}
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className={itemClass} onClick={signOut}>
            {t("nav_logout")}
          </Button>
        </>
      ) : (
        <>
          <Button asChild variant="ghost" size="sm" className={itemClass}>
            <Link to="/auth" onClick={closeMenu}>
              {t("nav_login")}
            </Link>
          </Button>
          <Button asChild size="sm" className={itemClass}>
            <Link to="/auth" search={{ mode: "signup" }} onClick={closeMenu}>
              {t("nav_register")}
            </Link>
          </Button>
        </>
      )}
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
        <Link to="/" className="mr-auto flex min-w-0 items-center gap-3" onClick={closeMenu}>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary font-display text-lg text-primary-foreground">
            {t("brand_badge")}
          </span>
          <span className="leading-tight">
            <span className="block font-display text-xl font-semibold sm:text-3xl">
              {t("brand")}
            </span>
            <span className="block font-display text-lg font-semibold sm:text-2xl">
              {t("brand_line2")}
            </span>
          </span>
        </Link>

        <div className="hidden md:contents">
          <LanguageToggle />
          {renderNav()}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-controls="site-header-mobile-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X /> : <Menu />}
        </Button>
      </div>

      {menuOpen && (
        <div id="site-header-mobile-nav" className="border-t border-border/70 md:hidden">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-1 px-4 py-3">
            <LanguageToggle className="mb-1" />
            {renderNav("w-full justify-start")}
          </div>
        </div>
      )}
    </header>
  );
}
