import { useI18n } from "@/lib/i18n";
import { memberName, useAdminData } from "@/lib/admin-data";
import { statusLabel } from "@/lib/admin-labels";
import { AdminShell } from "@/components/admin/AdminShell";
import { DataTable, EmptyState, SectionCard, StatusBadge, toneForStatus } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";

export function AdminJathagamRequests() {
  const { t, lang } = useI18n();
  const d = useAdminData();

  if (d.allowed === null || !d.allowed) return null;

  return (
    <AdminShell active="jathagam" title={t("admin_jathagam")} subtitle={t("jat_page_sub")}>
      <SectionCard
        title={t("adm_jat_requests")}
        action={
          <Button asChild size="sm" variant="secondary">
            <a href={lang === "ta" ? "/ta/jathagam" : "/jathagam"}>{t("jat_page_title")}</a>
          </Button>
        }
      >
        {d.loading ? (
          <p className="text-sm text-muted-foreground">{t("adm_loading")}</p>
        ) : d.jathagam.length === 0 ? (
          <EmptyState title={t("adm_empty_jat")} description={t("adm_empty_jat_d")} />
        ) : (
          <DataTable
            head={[
              t("adm_member"),
              t("jat_birth"),
              t("adm_date"),
              t("adm_payment"),
              t("adm_status"),
              t("adm_actions"),
            ]}
          >
            {d.jathagam.map((j) => {
              const payment = d.payments.find((p) => p.user_id === j.user_id && p.item === "jathagam");
              return (
                <tr key={j.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4 font-medium">{memberName(d.profiles, j.user_id)}</td>
                  <td className="py-2 pr-4">
                    {j.birth_date} · {j.birth_time} · {j.birth_place}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {j.created_at ? new Date(j.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge tone={payment ? toneForStatus(payment.status) : "neutral"}>
                      {payment ? statusLabel(t, payment.status) : t("adm_none")}
                    </StatusBadge>
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge tone={toneForStatus(j.status)}>{statusLabel(t, j.status)}</StatusBadge>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {j.report_key && (
                        <Button size="sm" variant="secondary" onClick={() => d.openDoc(j.report_key!)}>
                          {t("download_report")}
                        </Button>
                      )}
                      <label className="text-xs">
                        <span className="mr-2">{t("upload_report")}</span>
                        <input
                          type="file"
                          accept="application/pdf,image/jpeg,image/png"
                          disabled={d.busy}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void d.uploadHoroscope(j.id, f);
                          }}
                        />
                      </label>
                    </div>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </SectionCard>
    </AdminShell>
  );
}
