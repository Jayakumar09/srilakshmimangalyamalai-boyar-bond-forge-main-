import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useAdminData } from "@/lib/admin-data";
import { statusLabel } from "@/lib/admin-labels";
import { AdminShell } from "@/components/admin/AdminShell";
import { EmptyState, SectionCard, StatusBadge, toneForStatus } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AdminApprovals() {
  const { t } = useI18n();
  const d = useAdminData();
  const [notes, setNotes] = useState<Record<string, string>>({});

  if (d.allowed === null || !d.allowed) return null;

  const pending = d.profiles.filter((p) => p.status === "pending" && p.submitted_at);

  function confirmDecide(id: string, status: "approved" | "rejected") {
    const ok = window.confirm(status === "approved" ? t("adm_confirm_approve") : t("adm_confirm_reject"));
    if (ok) void d.decideProfile(id, status, notes[id] ?? null);
  }

  return (
    <AdminShell active="approvals" title={t("admin_queue")}>
      {d.loading ? (
        <p className="text-sm text-muted-foreground">{t("adm_loading")}</p>
      ) : pending.length === 0 ? (
        <EmptyState title={t("adm_empty_approvals")} description={t("adm_empty_approvals_d")} />
      ) : (
        <div className="space-y-5">
          {pending.map((p) => {
            const userDocs = d.docs.filter((doc) => doc.user_id === p.id);
            const payment = d.payments.find((x) => x.user_id === p.id);
            return (
              <SectionCard
                key={p.id}
                title={p.full_name ?? "—"}
                action={
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => confirmDecide(p.id, "approved")}>
                      {t("approve")}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => confirmDecide(p.id, "rejected")}>
                      {t("reject")}
                    </Button>
                  </div>
                }
              >
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <p className="text-muted-foreground">
                    {[p.gender, p.date_of_birth, p.marital_status, p.sub_caste].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-muted-foreground">
                    {[p.education_level, p.profession, p.native_district].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-muted-foreground">{[p.email, p.phone].filter(Boolean).join(" · ")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("adm_profile_id")}: {p.id.slice(0, 8)} · {t("adm_reg_date")}:{" "}
                    {p.submitted_at ? new Date(p.submitted_at).toLocaleDateString() : "—"}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusBadge tone={p.photo_url ? "success" : "danger"}>
                    {t("adm_photo")}: {p.photo_url ? t("adm_uploaded") : t("adm_missing")}
                  </StatusBadge>
                  <StatusBadge tone={userDocs.some((x) => x.doc_type === "govt_id") ? "success" : "danger"}>
                    {t("adm_govt_id")}:{" "}
                    {userDocs.some((x) => x.doc_type === "govt_id") ? t("adm_uploaded") : t("adm_missing")}
                  </StatusBadge>
                  <StatusBadge tone={payment ? toneForStatus(payment.status) : "neutral"}>
                    {t("adm_payment")}: {payment ? statusLabel(t, payment.status) : t("adm_none")}
                  </StatusBadge>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {userDocs.map((doc) => (
                    <Button
                      key={doc.id}
                      size="sm"
                      variant="secondary"
                      onClick={() => d.openDoc(doc.storage_key)}
                    >
                      {doc.doc_type}
                      {doc.id_kind ? ` (${doc.id_kind})` : ""}
                      {doc.ai_check_status ? ` · AI: ${doc.ai_check_status}` : ""}
                    </Button>
                  ))}
                </div>
                {userDocs[0]?.ai_check_notes && (
                  <p className="mt-2 text-xs text-muted-foreground">{userDocs[0].ai_check_notes}</p>
                )}

                <Input
                  className="mt-3"
                  placeholder={t("admin_notes")}
                  value={notes[p.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                />
              </SectionCard>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}
