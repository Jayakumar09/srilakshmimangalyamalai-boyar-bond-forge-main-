import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  ClipboardCheck,
  IndianRupee,
  Sparkles,
  ShieldAlert,
  Bell,
  MessageSquare,
  Settings,
  Menu,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type AdminSection =
  | "dashboard"
  | "members"
  | "approvals"
  | "payments"
  | "jathagam"
  | "reports"
  | "messages"
  | "alerts"
  | "settings";

const NAV: { key: AdminSection; slug: string; labelKey: string; icon: typeof Users }[] = [
  { key: "dashboard", slug: "", labelKey: "adm_nav_dashboard", icon: LayoutDashboard },
  { key: "members", slug: "/members", labelKey: "adm_nav_members", icon: Users },
  { key: "approvals", slug: "/approvals", labelKey: "adm_nav_approvals", icon: ClipboardCheck },
  { key: "payments", slug: "/payments", labelKey: "adm_nav_payments", icon: IndianRupee },
  { key: "jathagam", slug: "/jathagam", labelKey: "adm_nav_jathagam", icon: Sparkles },
  { key: "reports", slug: "/reports", labelKey: "adm_nav_reports", icon: ShieldAlert },
  { key: "messages", slug: "/messages", labelKey: "adm_nav_messages", icon: MessageSquare },
  { key: "alerts", slug: "/alerts", labelKey: "adm_nav_alerts", icon: Bell },
  { key: "settings", slug: "/settings", labelKey: "adm_nav_settings", icon: Settings },
];

export function AdminShell({
  active,
  title,
  subtitle,
  children,
}: {
  active: AdminSection;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  const isTa = pathname.startsWith("/tn");
  const base = isTa ? "/tn/admin" : "/en/admin";
  const otherPath = isTa ? pathname.replace(/^\/tn/, "/en") : pathname.replace(/^\/en/, "/tn");

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const nav = (
    <nav className="space-y-1">
      {NAV.map((item) => {
        const Icon = item.icon;
        return (
          <a
            key={item.key}
            href={`${base}${item.slug}`}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active === item.key
                ? "bg-primary text-primary-foreground"
                : "text-foreground/80 hover:bg-secondary",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{t(item.labelKey)}</span>
          </a>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-secondary/30">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
          <a href={base} className="mr-auto flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-primary font-display text-lg text-primary-foreground">
              ஸ்ரீ
            </span>
            <span className="leading-tight">
              <span className="block font-display text-base font-semibold sm:text-lg">
                {t("brand")}
              </span>
              <span className="block text-xs text-muted-foreground">{t("adm_title")}</span>
            </span>
          </a>
          <div className="inline-flex items-center rounded-full border border-border bg-card p-0.5 text-xs font-semibold">
            <a
              href={isTa ? otherPath : pathname}
              className={cn(
                "rounded-full px-3 py-1",
                !isTa ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              English
            </a>
            <a
              href={isTa ? pathname : otherPath}
              className={cn(
                "rounded-full px-3 py-1",
                isTa ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              தமிழ்
            </a>
          </div>
          <Button asChild variant="ghost" size="sm">
            <a href={`${base}/alerts`}>
              <Bell className="size-4" />
            </a>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <a href="/dashboard">{t("nav_dashboard")}</a>
          </Button>
          <Button variant="ghost" size="sm" onClick={signOut}>
            {t("nav_logout")}
          </Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-24 rounded-xl border border-border bg-card p-3 shadow-sm">
            {nav}
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {open && (
            <div className="mb-4 rounded-xl border border-border bg-card p-3 shadow-sm lg:hidden">
              {nav}
            </div>
          )}
          <div className="mb-5">
            <h1 className="font-display text-2xl font-semibold sm:text-3xl">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
            <div className="gold-rule mt-3 w-20" />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
