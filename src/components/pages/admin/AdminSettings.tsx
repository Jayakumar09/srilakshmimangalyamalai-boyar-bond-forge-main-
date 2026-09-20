import { useI18n } from "@/lib/i18n";
import { useAdminData } from "@/lib/admin-data";
import { formatBytes } from "@/lib/compress";
import { AdminShell } from "@/components/admin/AdminShell";
import { Meter, SectionCard, StatCard } from "@/components/admin/AdminUI";

export function AdminSettings() {
  const { t } = useI18n();
  const d = useAdminData();

  if (d.allowed === null || !d.allowed) return null;

  return (
    <AdminShell active="settings" title={t("adm_nav_settings")} subtitle={t("adm_settings_d")}>
      <div className="space-y-5">
        <SectionCard title={t("contact")}>
          <ul className="space-y-1 text-sm">
            <li>vijayalakshmi@srilakshmimangalyamalai.com</li>
            <li>
              +91 76391 50271 · <span className="text-muted-foreground">{t("phone_general")}</span>
            </li>
            <li>
              +91 90427 61438 ·{" "}
              <span className="text-muted-foreground">{t("phone_whatsapp_only")}</span>
            </li>
          </ul>
        </SectionCard>

        <SectionCard title={t("adm_system_usage")}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
            <StatCard label={t("adm_total_members")} value={d.profiles.length} />
          </div>
        </SectionCard>

        <SectionCard title={t("plans_title")}>
          <ul className="space-y-1 text-sm">
            <li>{t("plan_free")} — ₹0</li>
            <li>{t("plan_std")} — ₹2,000</li>
            <li>{t("plan_prem")} — ₹5,000</li>
            <li>{t("jat_page_title")} — ₹500</li>
          </ul>
        </SectionCard>
      </div>
    </AdminShell>
  );
}
