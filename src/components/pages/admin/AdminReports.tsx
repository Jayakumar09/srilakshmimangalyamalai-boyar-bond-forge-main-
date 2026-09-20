import { useI18n } from "@/lib/i18n";
import { memberName, useAdminData } from "@/lib/admin-data";
import { statusLabel } from "@/lib/admin-labels";
import { AdminShell } from "@/components/admin/AdminShell";
import { DataTable, EmptyState, SectionCard, StatusBadge, toneForStatus } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";

export function AdminReports() {
  const { t } = useI18n();
  const d = useAdminData();

  if (d.allowed === null || !d.allowed) return null;

  return (
    <AdminShell active="reports" title={t("admin_reports")}>
      <div className="space-y-5">
        <SectionCard title={t("admin_reports")}>
          {d.loading ? (
            <p className="text-sm text-muted-foreground">{t("adm_loading")}</p>
          ) : d.reports.length === 0 ? (
            <EmptyState title={t("adm_empty_reports")} description={t("adm_empty_reports_d")} />
          ) : (
            <DataTable
              head={[
                t("adm_member"),
                t("adm_reporter"),
                t("adm_reason"),
                t("adm_date"),
                t("adm_status"),
                t("adm_actions"),
              ]}
            >
              {d.reports.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4 font-medium">{memberName(d.profiles, r.target_id)}</td>
                  <td className="py-2 pr-4">{memberName(d.profiles, r.reporter_id)}</td>
                  <td className="py-2 pr-4">
                    {r.reason}
                    {r.details && <span className="block text-xs text-muted-foreground">{r.details}</span>}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge tone={toneForStatus(r.status)}>{statusLabel(t, r.status)}</StatusBadge>
                  </td>
                  <td className="py-2 pr-4">
                    {r.status === "open" && (
                      <Button size="sm" variant="secondary" onClick={() => d.closeReport(r.id)}>
                        {t("adm_close")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </SectionCard>

        <SectionCard title={t("block")}>
          {d.blocks.length === 0 ? (
            <EmptyState title={t("adm_empty_reports")} description={t("adm_empty_reports_d")} />
          ) : (
            <DataTable head={[t("adm_member"), t("adm_reporter"), t("adm_date")]}>
              {d.blocks.map((b) => (
                <tr key={b.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4 font-medium">{memberName(d.profiles, b.target_id)}</td>
                  <td className="py-2 pr-4">{memberName(d.profiles, b.user_id)}</td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {new Date(b.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </SectionCard>
      </div>
    </AdminShell>
  );
}
