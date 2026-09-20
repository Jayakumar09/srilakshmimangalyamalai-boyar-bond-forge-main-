import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAdminData } from "@/lib/admin-data";
import { formatBytes } from "@/lib/compress";
import { AdminShell } from "@/components/admin/AdminShell";
import { EmptyState, Meter, SectionCard, StatCard, StatusBadge, toneForStatus } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";

export function AdminOverview() {
  const { t, lang } = useI18n();
  const d = useAdminData();
  const base = lang === "ta" ? "/tn/admin" : "/en/admin";

  if (d.allowed === null || !d.allowed) return null;

  const pending = d.profiles.filter((p) => p.status === "pending" && p.submitted_at);
  const approved = d.profiles.filter((p) => p.status === "approved");
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const fresh = d.profiles.filter((p) => p.created_at && new Date(p.created_at).getTime() > weekAgo);
  const openReports = d.reports.filter((r) => r.status === "open");
  const pendingPayments = d.payments.filter((p) => p.status === "submitted");
  const warn = d.storagePct >= 90 || d.dbPct >= 90;
  const clientMade = d.profiles.filter((p) => (p.profile_created_by ?? "client") !== "admin");
  const adminMade = d.profiles.filter((p) => p.profile_created_by === "admin");

  return (
    <AdminShell active="dashboard" title={t("adm_title")} subtitle={t("adm_home_sub")}>
      {warn && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-destructive" />
          {t("adm_storage_warn")}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("adm_total_members")} value={d.loading ? "…" : d.profiles.length} />
        <StatCard label={t("adm_nav_approvals")} value={d.loading ? "…" : pending.length} />
        <StatCard label={t("adm_verified_members")} value={d.loading ? "…" : approved.length} />
        <StatCard label={t("adm_new_regs")} value={d.loading ? "…" : fresh.length} />
        <StatCard label={t("adm_open_reports")} value={d.loading ? "…" : openReports.length} />
        <StatCard label={t("adm_pending_payments")} value={d.loading ? "…" : pendingPayments.length} />
        <StatCard label={t("adm_jat_requests")} value={d.loading ? "…" : d.jathagam.length} />
        <StatCard label={t("adm_client_profiles")} value={d.loading ? "…" : clientMade.length} />
        <StatCard label={t("adm_admin_profiles")} value={d.loading ? "…" : adminMade.length} />
        <StatCard label={t("adm_active_alerts")} value={d.loading ? "…" : d.alerts.length} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <SectionCard
          title={t("adm_nav_approvals")}
          action={
            <Button asChild size="sm" variant="secondary">
              <a href={`${base}/approvals`}>{t("adm_view")}</a>
            </Button>
          }
        >
          {pending.length === 0 ? (
            <EmptyState title={t("adm_empty_approvals")} description={t("adm_empty_approvals_d")} />
          ) : (
            <ul className="space-y-2 text-sm">
              {pending.slice(0, 5).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{p.full_name ?? p.email}</span>
                  <StatusBadge tone="warning">{p.status}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={t("adm_nav_payments")}
          action={
            <Button asChild size="sm" variant="secondary">
              <a href={`${base}/payments`}>{t("adm_view")}</a>
            </Button>
          }
        >
          {d.payments.length === 0 ? (
            <EmptyState title={t("adm_empty_payments")} description={t("adm_empty_payments_d")} />
          ) : (
            <ul className="space-y-2 text-sm">
              {d.payments.slice(0, 5).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <span className="truncate capitalize">
                    {p.item} · ₹{p.amount_inr.toLocaleString("en-IN")}
                  </span>
                  <StatusBadge tone={toneForStatus(p.status)}>{p.status}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <h2 className="mt-8 font-display text-xl font-semibold">{t("adm_system_usage")}</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Meter
          title={t("adm_r2_storage")}
          used={`${formatBytes(d.storageUsed)} / 10 GB`}
          pct={d.storagePct}
        />
        <Meter
          title={t("adm_db_usage")}
          used={`${formatBytes(d.dbApprox)} / 500 MB`}
          pct={d.dbPct}
        />
        <StatCard
          label="Members / open reports"
          value={`${d.profiles.length} / ${openReports.length}`}
        />
      </div>
    </AdminShell>
  );
}
