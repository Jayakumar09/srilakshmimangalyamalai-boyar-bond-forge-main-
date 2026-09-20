import { useI18n } from "@/lib/i18n";
import { useAdminData } from "@/lib/admin-data";
import { AdminShell } from "@/components/admin/AdminShell";
import { EmptyState, SectionCard, StatusBadge } from "@/components/admin/AdminUI";

export function AdminAlerts() {
  const { t } = useI18n();
  const d = useAdminData();

  if (d.allowed === null || !d.allowed) return null;

  return (
    <AdminShell active="alerts" title={t("admin_alerts")}>
      <SectionCard title={t("adm_active_alerts")}>
        {d.loading ? (
          <p className="text-sm text-muted-foreground">{t("adm_loading")}</p>
        ) : d.alerts.length === 0 ? (
          <EmptyState title={t("adm_empty_alerts")} description={t("adm_empty_alerts_d")} />
        ) : (
          <ul className="space-y-3">
            {d.alerts.map((a) => (
              <li key={a.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.subject}</span>
                  <StatusBadge tone={a.emailed ? "success" : "warning"}>
                    {a.emailed ? "emailed" : "pending"}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-muted-foreground">{a.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.email_to} · {new Date(a.created_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </AdminShell>
  );
}
