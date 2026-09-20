import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { createViewUrl } from "@/lib/storage.functions";
import type { AdminData, AdminProfile, ProfileAudit } from "@/lib/admin-data";
import { ageFrom } from "@/lib/admin-data";
import { actorLabel, createdByLabel, planLabel, statusLabel } from "@/lib/admin-labels";
import { StatusBadge, toneForStatus } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="min-w-[9rem] text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">
        {value === null || value === undefined || value === "" ? "—" : value}
      </span>
    </div>
  );
}

const EDITABLE: { key: keyof AdminProfile; labelKey: string }[] = [
  { key: "full_name", labelKey: "adm_f_full_name" },
  { key: "phone", labelKey: "adm_f_phone" },
  { key: "whatsapp", labelKey: "adm_f_whatsapp" },
  { key: "city", labelKey: "adm_f_city" },
  { key: "native_district", labelKey: "adm_f_district" },
  { key: "education_level", labelKey: "adm_f_education" },
  { key: "profession", labelKey: "adm_f_profession" },
  { key: "family_details", labelKey: "adm_f_family" },
  { key: "pref_notes", labelKey: "adm_f_prefs" },
  { key: "about", labelKey: "adm_f_about" },
];

/** Full profile review for admins: details, documents, history and on-behalf-of-client actions. */
export function ProfileReviewDialog({
  profile,
  d,
  onClose,
}: {
  profile: AdminProfile;
  d: AdminData;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [audit, setAudit] = useState<ProfileAudit[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);

  useEffect(() => {
    void d.loadAudit(profile.id).then(setAudit);
  }, [d, profile.id]);

  useEffect(() => {
    let alive = true;
    setPhotoSrc(null);
    if (profile.photo_url) {
      createViewUrl({ data: { key: profile.photo_url } })
        .then(({ url }) => alive && setPhotoSrc(url))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [profile.photo_url]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of EDITABLE) next[f.key as string] = (profile[f.key] as string | null) ?? "";
    setForm(next);
  }, [profile]);

  const docs = d.docs.filter((x) => x.user_id === profile.id);
  const payment = d.payments.find((x) => x.user_id === profile.id);

  async function save() {
    const ok = await d.adminUpdateProfile(profile.id, form, "Updated on behalf of client");
    if (ok) {
      toast.success(t("adm_saved"));
      setEditing(false);
    }
  }

  async function correction() {
    const text = window.prompt(t("adm_correction_prompt"));
    if (!text) return;
    const ok = await d.requestCorrection(profile.id, text);
    if (ok) toast.success(t("adm_correction_sent"));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-border bg-card shadow-lg">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="font-display text-lg font-semibold">{t("adm_profile_review")}</h2>
          <StatusBadge tone={toneForStatus(profile.status)}>
            {statusLabel(t, profile.status)}
          </StatusBadge>
          <StatusBadge tone={profile.profile_created_by === "admin" ? "warning" : "neutral"}>
            {createdByLabel(t, profile.profile_created_by)}
          </StatusBadge>
          <Button className="ml-auto" size="sm" variant="ghost" onClick={onClose}>
            {t("adm_close_btn")}
          </Button>
        </div>

        <div className="max-h-[75vh] space-y-5 overflow-y-auto p-4">
          <div className="flex flex-wrap items-start gap-4">
            {photoSrc ? (
              <img
                src={photoSrc}
                alt=""
                className="size-24 rounded-lg border border-border object-cover"
              />
            ) : (
              <div className="grid size-24 place-items-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                {t("adm_missing")}
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <Row label={t("adm_name")} value={profile.full_name} />
              <Row label={t("adm_profile_id")} value={profile.client_profile_id ?? "—"} />
              <Row label={t("adm_age")} value={ageFrom(profile.date_of_birth)} />
              <Row label={t("adm_f_gender")} value={profile.gender} />
              <Row label={t("adm_f_marital")} value={profile.marital_status} />
              <Row label={t("adm_plan")} value={planLabel(t, profile.membership_plan)} />
            </div>
          </div>

          <section className="grid gap-1 sm:grid-cols-2">
            <Row label={t("adm_f_email")} value={profile.email} />
            <Row label={t("adm_f_phone")} value={profile.phone} />
            <Row label={t("adm_f_whatsapp")} value={profile.whatsapp} />
            <Row
              label={t("adm_location")}
              value={[profile.city, profile.native_district, profile.state]
                .filter(Boolean)
                .join(", ")}
            />
            <Row
              label={t("adm_f_education")}
              value={[profile.education_level, profile.education_detail]
                .filter(Boolean)
                .join(" · ")}
            />
            <Row
              label={t("adm_f_profession")}
              value={[profile.profession, profile.job_detail].filter(Boolean).join(" · ")}
            />
            <Row
              label={t("adm_family")}
              value={[profile.father_name, profile.mother_name, profile.family_details]
                .filter(Boolean)
                .join(" · ")}
            />
            <Row label={t("adm_prefs")} value={profile.pref_notes} />
            <Row
              label={t("adm_reg_date")}
              value={profile.created_at ? new Date(profile.created_at).toLocaleDateString() : null}
            />
            <Row
              label={t("adm_payment")}
              value={
                payment
                  ? `${planLabel(t, payment.item)} · ${statusLabel(t, payment.status)}`
                  : t("adm_none")
              }
            />
            <Row
              label={t("adm_created_by")}
              value={createdByLabel(t, profile.profile_created_by)}
            />
            <Row
              label={t("adm_last_updated")}
              value={
                profile.last_updated_at
                  ? `${actorLabel(t, profile.last_updated_by_type)} · ${new Date(profile.last_updated_at).toLocaleString()}`
                  : null
              }
            />
          </section>

          <section>
            <h3 className="mb-2 font-medium">{t("adm_documents")}</h3>
            <div className="flex flex-wrap gap-2">
              {docs.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("adm_missing")}</p>
              )}
              {docs.map((doc) => (
                <Button
                  key={doc.id}
                  size="sm"
                  variant="secondary"
                  onClick={() => d.openDoc(doc.storage_key)}
                >
                  {doc.doc_type}
                  {doc.id_kind ? ` (${doc.id_kind})` : ""}
                  {doc.ai_check_status ? ` · ${doc.ai_check_status}` : ""}
                </Button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 font-medium">{t("adm_audit_history")}</h3>
            {audit.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("adm_no_audit")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {audit.map((a) => (
                  <li key={a.id} className="text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()} —{" "}
                    {a.action === "admin_created"
                      ? t("audit_admin_created")
                      : t("audit_admin_updated")}
                    {a.details ? ` (${a.details})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {editing && (
            <section className="grid gap-2 sm:grid-cols-2">
              {EDITABLE.map((f) => (
                <label key={f.key as string} className="text-sm">
                  <span className="mb-1 block text-muted-foreground">{t(f.labelKey)}</span>
                  <Input
                    value={form[f.key as string] ?? ""}
                    onChange={(e) => setForm((s) => ({ ...s, [f.key as string]: e.target.value }))}
                  />
                </label>
              ))}
            </section>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          {editing ? (
            <>
              <Button size="sm" disabled={d.busy} onClick={save}>
                {t("adm_save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t("adm_close_btn")}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                {t("adm_edit_profile")}
              </Button>
              {profile.status !== "approved" && (
                <Button
                  size="sm"
                  onClick={() => {
                    if (window.confirm(t("adm_confirm_approve")))
                      void d.decideProfile(profile.id, "approved", null);
                  }}
                >
                  {t("approve")}
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (window.confirm(t("adm_confirm_reject")))
                    void d.decideProfile(profile.id, "rejected", null);
                }}
              >
                {t("reject")}
              </Button>
              <Button size="sm" variant="secondary" onClick={correction}>
                {t("adm_request_correction")}
              </Button>
              {profile.status === "approved" && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (window.confirm(t("adm_confirm_suspend")))
                      void d.decideProfile(profile.id, "rejected", "Suspended by admin");
                  }}
                >
                  {t("adm_suspend")}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
