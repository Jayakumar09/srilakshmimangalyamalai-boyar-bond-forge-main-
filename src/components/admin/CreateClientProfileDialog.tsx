import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { createClientProfile } from "@/lib/admin-profiles.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FIELDS: { key: string; labelKey: string }[] = [
  { key: "full_name", labelKey: "adm_f_full_name" },
  { key: "email", labelKey: "adm_f_email" },
  { key: "phone", labelKey: "adm_f_phone" },
  { key: "whatsapp", labelKey: "adm_f_whatsapp" },
  { key: "gender", labelKey: "adm_f_gender" },
  { key: "date_of_birth", labelKey: "adm_f_dob" },
  { key: "marital_status", labelKey: "adm_f_marital" },
  { key: "sub_caste", labelKey: "adm_f_subcaste" },
  { key: "city", labelKey: "adm_f_city" },
  { key: "native_district", labelKey: "adm_f_district" },
  { key: "education_level", labelKey: "adm_f_education" },
  { key: "profession", labelKey: "adm_f_profession" },
  { key: "family_details", labelKey: "adm_f_family" },
  { key: "pref_notes", labelKey: "adm_f_prefs" },
];

/** Admin creates a profile on behalf of a client. The client stays the owner. */
export function CreateClientProfileDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!form["email"]?.trim() || !form["full_name"]?.trim()) {
      toast.error(t("adm_email_required"));
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, string> = {};
      for (const f of FIELDS) {
        const v = form[f.key]?.trim();
        if (v) payload[f.key] = v;
      }
      payload["redirectUrl"] = window.location.origin;
      const res = await createClientProfile({ data: payload as never });
      toast.success(res.existed ? t("adm_exists_updated") : t("adm_created_ok"));
      if (res.invitation === "sent") toast.info(t("adm_invite_sent"));
      else if (res.invitation === "failed") toast.warning(t("adm_invite_failed"));
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-lg">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-display text-lg font-semibold">{t("adm_create_profile")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("adm_create_profile_d")}</p>
        </div>
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto p-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="text-sm">
              <span className="mb-1 block text-muted-foreground">{t(f.labelKey)}</span>
              <Input
                type={f.key === "date_of_birth" ? "date" : "text"}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="flex gap-2 border-t border-border px-4 py-3">
          <Button size="sm" disabled={busy} onClick={submit}>
            {t("adm_save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t("adm_close_btn")}
          </Button>
        </div>
      </div>
    </div>
  );
}
