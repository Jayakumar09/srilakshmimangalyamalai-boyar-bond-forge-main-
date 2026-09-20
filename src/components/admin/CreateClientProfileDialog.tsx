import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { createClientProfile } from "@/lib/admin-profiles.functions";
import { uploadToR2 } from "@/lib/upload";
import { formatBytes } from "@/lib/compress";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload } from "lucide-react";

const FIELDS: { key: string; labelKey: string; type?: string; full?: boolean }[] = [
  { key: "full_name", labelKey: "adm_f_full_name" },
  { key: "email", labelKey: "adm_f_email" },
  { key: "phone", labelKey: "adm_f_phone" },
  { key: "whatsapp", labelKey: "adm_f_whatsapp" },
  { key: "gender", labelKey: "adm_f_gender" },
  { key: "date_of_birth", labelKey: "adm_f_dob", type: "date" },
  { key: "marital_status", labelKey: "adm_f_marital" },
  { key: "sub_caste", labelKey: "adm_f_subcaste" },
  { key: "gothram", labelKey: "gothram" },
  { key: "mother_tongue", labelKey: "mother_tongue" },
  { key: "height_cm", labelKey: "height", type: "number" },
  { key: "weight_kg", labelKey: "weight", type: "number" },
  { key: "birth_time", labelKey: "birth_time" },
  { key: "birth_place", labelKey: "birth_place" },
  { key: "city", labelKey: "adm_f_city" },
  { key: "native_district", labelKey: "adm_f_district" },
  { key: "address_line", labelKey: "address" },
  { key: "state", labelKey: "state" },
  { key: "pincode", labelKey: "pincode" },
  { key: "education_level", labelKey: "adm_f_education" },
  { key: "education_detail", labelKey: "education_detail" },
  { key: "profession", labelKey: "adm_f_profession" },
  { key: "job_detail", labelKey: "job_detail" },
  { key: "annual_income", labelKey: "income" },
  { key: "family_type", labelKey: "family_type" },
  { key: "family_status", labelKey: "family_status" },
  { key: "father_name", labelKey: "father_name" },
  { key: "father_occupation", labelKey: "father_occ" },
  { key: "mother_name", labelKey: "mother_name" },
  { key: "mother_occupation", labelKey: "mother_occ" },
  { key: "siblings", labelKey: "siblings" },
  { key: "family_details", labelKey: "adm_f_family" },
  { key: "pref_age_min", labelKey: "pref_age_min_label", type: "number" },
  { key: "pref_age_max", labelKey: "pref_age_max_label", type: "number" },
  { key: "pref_height_min_cm", labelKey: "pref_height", type: "number" },
  { key: "pref_marital_status", labelKey: "marital_status" },
  { key: "pref_sub_caste", labelKey: "sub_caste" },
  { key: "pref_education", labelKey: "education_level" },
  { key: "pref_profession", labelKey: "profession" },
  { key: "pref_district", labelKey: "district" },
  { key: "pref_notes", labelKey: "adm_f_prefs" },
  { key: "about", labelKey: "adm_f_about" },
];

const ID_KINDS: { v: string; labelKey: string }[] = [
  { v: "Aadhaar", labelKey: "id_aadhaar" },
  { v: "PAN", labelKey: "id_pan" },
  { v: "Voter ID", labelKey: "id_voter" },
  { v: "Driving Licence", labelKey: "id_dl" },
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
  const [idKind, setIdKind] = useState("Aadhaar");
  const [photo, setPhoto] = useState<File | null>(null);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [divorceFile, setDivorceFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const needsDivorceDoc =
    form["marital_status"] === "Divorced" || form["marital_status"] === "Widowed";

  async function submit() {
    if (!form["email"]?.trim() || !form["full_name"]?.trim()) {
      toast.error(t("adm_email_required"));
      return;
    }
    setBusy(true);
    let profileId: string | null = null;
    try {
      const payload: Record<string, string> = {};
      for (const f of FIELDS) {
        const v = form[f.key]?.trim();
        if (v) payload[f.key] = v;
      }
      payload["redirectUrl"] = window.location.origin;
      const res = await createClientProfile({ data: payload as never });
      profileId = res.id;

      try {
        const photoUp = photo ? await uploadToR2(photo, "photo", profileId) : null;
        const idUp = idFile ? await uploadToR2(idFile, "govt_id", profileId) : null;
        const divorceUp = divorceFile
          ? await uploadToR2(divorceFile, "divorce_doc", profileId)
          : null;

        if (photoUp) {
          const { error: photoError } = await supabase
            .from("profiles")
            .update({ photo_url: photoUp.key })
            .eq("id", profileId);
          if (photoError) throw photoError;
        }

        const docs: {
          user_id: string;
          doc_type: string;
          id_kind?: string;
          storage_key: string;
          file_name: string | null;
          mime_type: string | null;
          size_bytes: number | null;
          ai_check_status: string;
        }[] = [];
        if (photoUp) {
          docs.push({
            user_id: profileId,
            doc_type: "photo",
            storage_key: photoUp.key,
            file_name: photoUp.fileName,
            mime_type: photoUp.mimeType,
            size_bytes: photoUp.sizeBytes,
            ai_check_status: "not_run",
          });
        }
        if (idUp) {
          docs.push({
            user_id: profileId,
            doc_type: "govt_id",
            id_kind: idKind,
            storage_key: idUp.key,
            file_name: idUp.fileName,
            mime_type: idUp.mimeType,
            size_bytes: idUp.sizeBytes,
            ai_check_status: "not_run",
          });
        }
        if (divorceUp) {
          docs.push({
            user_id: profileId,
            doc_type: "divorce_doc",
            storage_key: divorceUp.key,
            file_name: divorceUp.fileName,
            mime_type: divorceUp.mimeType,
            size_bytes: divorceUp.sizeBytes,
            ai_check_status: "not_run",
          });
        }
        if (docs.length > 0) {
          const { error: docError } = await supabase.from("documents").insert(docs);
          if (docError) throw docError;
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? `${t("adm_created_ok")} — ${err.message}` : t("adm_upload_failed"),
        );
      }

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
                type={f.type ?? "text"}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            </label>
          ))}

          <div className="sm:col-span-2 space-y-4 border-t border-border pt-3">
            <p className="text-sm font-medium text-muted-foreground">{t("adm_upload_docs")}</p>

            <FileField label={t("photo")} accept="image/*" file={photo} onFile={setPhoto} />
            <div>
              <Label className="mb-1.5 block text-sm">{t("id_kind")}</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={idKind}
                onChange={(e) => setIdKind(e.target.value)}
              >
                {ID_KINDS.map((k) => (
                  <option key={k.v} value={k.v}>
                    {t(k.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            <FileField label={t("govt_id")} accept="image/*" file={idFile} onFile={setIdFile} />
            {needsDivorceDoc && (
              <FileField
                label={t("divorce_doc")}
                note={t("divorce_doc_note")}
                accept="image/*,application/pdf"
                file={divorceFile}
                onFile={setDivorceFile}
              />
            )}
          </div>
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

function FileField({
  label,
  file,
  onFile,
  accept,
  note,
}: {
  label: string;
  file: File | null;
  onFile: (f: File | null) => void;
  accept: string;
  note?: string;
}) {
  const { t } = useI18n();
  return (
    <div>
      <Label className="mb-1.5 block text-sm">{label}</Label>
      {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm hover:bg-accent/10">
        <Upload className="size-4 text-primary" />
        <span className="text-muted-foreground">
          {file ? `${file.name} · ${formatBytes(file.size)}` : t("choose_file")}
        </span>
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </label>
    </div>
  );
}
