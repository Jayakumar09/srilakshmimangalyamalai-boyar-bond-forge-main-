import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ageFrom, useAdminData } from "@/lib/admin-data";
import type { AdminProfile } from "@/lib/admin-data";
import { createdByLabel, isProfileDraft, planLabel, statusLabel } from "@/lib/admin-labels";
import { AdminShell } from "@/components/admin/AdminShell";
import { DataTable, EmptyState, SectionCard, StatusBadge, toneForStatus } from "@/components/admin/AdminUI";
import { ProfileReviewDialog } from "@/components/admin/ProfileReviewDialog";
import { CreateClientProfileDialog } from "@/components/admin/CreateClientProfileDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AdminMembers() {
  const { t } = useI18n();
  const d = useAdminData();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [plan, setPlan] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [review, setReview] = useState<AdminProfile | null>(null);
  const [creating, setCreating] = useState(false);

  if (d.allowed === null || !d.allowed) return null;

  const needle = q.trim().toLowerCase();
  const rows = d.profiles.filter((p) => {
    if (status !== "all") {
      const match =
        status === "draft"
          ? isProfileDraft(p)
          : status === "pending"
            ? p.status === "pending" && Boolean(p.submitted_at)
            : p.status === status;
      if (!match) return false;
    }
    if (plan !== "all" && p.membership_plan !== plan) return false;
    if (origin !== "all" && (p.profile_created_by ?? "client") !== origin) return false;
    if (!needle) return true;
    return [p.full_name, p.email, p.phone, p.city, p.native_district]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });

  const current = review ? (d.profiles.find((p) => p.id === review.id) ?? review) : null;
  const selectClass = "h-9 rounded-md border border-border bg-background px-3 text-sm";

  return (
    <AdminShell active="members" title={t("adm_nav_members")}>
      <SectionCard
        title={t("adm_nav_members")}
        action={
          <Button size="sm" onClick={() => setCreating(true)}>
            {t("adm_create_profile")}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="max-w-xs"
            placeholder={t("adm_search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">{t("adm_all")}</option>
            <option value="pending">{t("st_pending")}</option>
            <option value="draft">{t("st_draft")}</option>
            <option value="approved">{t("st_approved")}</option>
            <option value="rejected">{t("st_rejected")}</option>
          </select>
          <select className={selectClass} value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="all">{t("adm_all")}</option>
            <option value="free">{t("plan_item_free")}</option>
            <option value="standard">{t("plan_item_standard")}</option>
            <option value="premium">{t("plan_item_premium")}</option>
          </select>
          <select className={selectClass} value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="all">{t("adm_all")}</option>
            <option value="client">{t("adm_client_created")}</option>
            <option value="admin">{t("adm_admin_created")}</option>
          </select>
          <span className="ml-auto text-sm text-muted-foreground">{rows.length}</span>
        </div>

        <div className="mt-4">
          {d.loading ? (
            <p className="text-sm text-muted-foreground">{t("adm_loading")}</p>
          ) : rows.length === 0 ? (
            <EmptyState title={t("adm_empty_members")} description={t("adm_empty_members_d")} />
          ) : (
            <DataTable
              head={[
                t("adm_name"),
                t("adm_profile_id"),
                t("adm_age"),
                t("adm_location"),
                t("adm_reg_date"),
                t("adm_plan"),
                t("adm_created_by"),
                t("adm_status"),
                t("adm_actions"),
              ]}
            >
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4 font-medium">{p.full_name ?? "—"}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{p.client_profile_id ?? "—"}</td>
                  <td className="py-2 pr-4">{ageFrom(p.date_of_birth) ?? "—"}</td>
                  <td className="py-2 pr-4">{p.city ?? p.native_district ?? "—"}</td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {p.created_at ? new Date(p.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-2 pr-4">{planLabel(t, p.membership_plan)}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge tone={p.profile_created_by === "admin" ? "warning" : "neutral"}>
                      {createdByLabel(t, p.profile_created_by)}
                    </StatusBadge>
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge tone={isProfileDraft(p) ? "neutral" : toneForStatus(p.status)}>
                      {isProfileDraft(p) ? t("st_draft") : statusLabel(t, p.status)}
                    </StatusBadge>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setReview(p)}>
                        {t("adm_review")}
                      </Button>
                      {p.status !== "approved" && p.submitted_at && (
                        <Button size="sm" onClick={() => d.decideProfile(p.id, "approved", null)}>
                          {t("approve")}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
      </SectionCard>

      {current && <ProfileReviewDialog profile={current} d={d} onClose={() => setReview(null)} />}
      {creating && (
        <CreateClientProfileDialog onClose={() => setCreating(false)} onCreated={() => void d.reload()} />
      )}
    </AdminShell>
  );
}
