import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { createViewUrl } from "@/lib/storage.functions";
import type { AdminData, AdminProfile, ClientRequest, ProfileAudit } from "@/lib/admin-data";
import { ageFrom } from "@/lib/admin-data";
import { uploadToR2 } from "@/lib/upload";
import { formatBytes } from "@/lib/compress";
import { supabase } from "@/integrations/supabase/client";
import { actorLabel, createdByLabel, isProfileDraft, planLabel, statusLabel } from "@/lib/admin-labels";
import { StatusBadge, toneForStatus } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CASTE_OPTIONS,
  EDUCATION_LEVELS,
  FAMILY_STATUSES,
  FAMILY_TYPES,
  GENDERS,
  ID_KINDS,
  MARITAL_STATUSES,
  type ProfileOption,
} from "@/lib/profile-options";
import { normalizeInternationalPhone, formatPhoneForDisplay, splitInternationalPhone } from "@/lib/phone";
import { normalizeBirthTime, formatBirthTime, birthTimeToInputValue } from "@/lib/format";
import { TimeInput } from "@/components/TimeInput";
import { CountryCodePhoneField } from "@/components/CountryCodePhoneField";
import { DEFAULT_COUNTRY_ISO } from "@/lib/country-codes";

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

type EditKind =
  | "text"
  | "number"
  | "date"
  | "time"
  | "phone"
  | "textarea"
  | "choice";

type EditField = {
  key: string;
  labelKey: string;
  kind: EditKind;
  options?: ProfileOption[];
  maxLength?: number;
  full?: boolean;
};

const EDIT_FIELDS: Record<string, EditField> = {
  full_name: { key: "full_name", labelKey: "adm_f_full_name", kind: "text", maxLength: 100 },
  date_of_birth: { key: "date_of_birth", labelKey: "adm_f_dob", kind: "date" },
  gender: { key: "gender", labelKey: "adm_f_gender", kind: "choice", options: GENDERS },
  marital_status: {
    key: "marital_status",
    labelKey: "adm_f_marital",
    kind: "choice",
    options: MARITAL_STATUSES,
  },
  caste: { key: "caste", labelKey: "caste", kind: "choice", options: CASTE_OPTIONS },
  sub_caste: { key: "sub_caste", labelKey: "adm_f_subcaste", kind: "text", maxLength: 80 },
  gothram: { key: "gothram", labelKey: "gothram", kind: "text", maxLength: 80 },
  mother_tongue: { key: "mother_tongue", labelKey: "mother_tongue", kind: "text", maxLength: 60 },
  height_cm: { key: "height_cm", labelKey: "height", kind: "number" },
  weight_kg: { key: "weight_kg", labelKey: "weight", kind: "number" },
  birth_time: { key: "birth_time", labelKey: "birth_time", kind: "time" },
  birth_place: { key: "birth_place", labelKey: "birth_place", kind: "text", maxLength: 100 },
  phone: { key: "phone", labelKey: "adm_f_phone", kind: "phone" },
  whatsapp: { key: "whatsapp", labelKey: "adm_f_whatsapp", kind: "phone" },
  city: { key: "city", labelKey: "adm_f_city", kind: "text", maxLength: 80 },
  native_district: { key: "native_district", labelKey: "adm_f_district", kind: "text", maxLength: 80 },
  state: { key: "state", labelKey: "state", kind: "text", maxLength: 80 },
  pincode: { key: "pincode", labelKey: "pincode", kind: "text", maxLength: 10 },
  address_line: { key: "address_line", labelKey: "address", kind: "textarea", maxLength: 300, full: true },
  education_level: {
    key: "education_level",
    labelKey: "adm_f_education",
    kind: "choice",
    options: EDUCATION_LEVELS,
  },
  education_detail: { key: "education_detail", labelKey: "education_detail", kind: "text", maxLength: 120 },
  profession: { key: "profession", labelKey: "adm_f_profession", kind: "text", maxLength: 80 },
  job_detail: { key: "job_detail", labelKey: "job_detail", kind: "text", maxLength: 150 },
  annual_income: { key: "annual_income", labelKey: "income", kind: "text", maxLength: 60 },
  about: { key: "about", labelKey: "adm_f_about", kind: "textarea", maxLength: 800, full: true },
  family_type: { key: "family_type", labelKey: "family_type", kind: "choice", options: FAMILY_TYPES },
  family_status: { key: "family_status", labelKey: "family_status", kind: "choice", options: FAMILY_STATUSES },
  father_name: { key: "father_name", labelKey: "father_name", kind: "text", maxLength: 100 },
  father_occupation: { key: "father_occupation", labelKey: "father_occ", kind: "text", maxLength: 100 },
  mother_name: { key: "mother_name", labelKey: "mother_name", kind: "text", maxLength: 100 },
  mother_occupation: { key: "mother_occupation", labelKey: "mother_occ", kind: "text", maxLength: 100 },
  brothers: { key: "brothers", labelKey: "brothers", kind: "number" },
  sisters: { key: "sisters", labelKey: "sisters", kind: "number" },
  family_details: { key: "family_details", labelKey: "adm_f_family", kind: "textarea", maxLength: 500, full: true },
  pref_age_min: { key: "pref_age_min", labelKey: "pref_age_min_label", kind: "number" },
  pref_age_max: { key: "pref_age_max", labelKey: "pref_age_max_label", kind: "number" },
  pref_height_min_cm: { key: "pref_height_min_cm", labelKey: "pref_height", kind: "number" },
  pref_education: { key: "pref_education", labelKey: "education_level", kind: "text", maxLength: 80 },
  pref_marital_status: { key: "pref_marital_status", labelKey: "marital_status", kind: "text", maxLength: 60 },
  pref_sub_caste: { key: "pref_sub_caste", labelKey: "sub_caste", kind: "text", maxLength: 80 },
  pref_profession: { key: "pref_profession", labelKey: "profession", kind: "text", maxLength: 80 },
  pref_district: { key: "pref_district", labelKey: "district", kind: "text", maxLength: 80 },
  pref_notes: { key: "pref_notes", labelKey: "adm_f_prefs", kind: "textarea", maxLength: 500, full: true },
};

const ALL_FIELD_KEYS = Object.keys(EDIT_FIELDS);

const NUMBER_FIELDS = new Set([
  "height_cm",
  "weight_kg",
  "brothers",
  "sisters",
  "pref_age_min",
  "pref_age_max",
  "pref_height_min_cm",
]);

function buildPatch(form: Record<string, string>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of ALL_FIELD_KEYS) {
    const raw = (form[key] ?? "").trim();
    if (raw === "") {
      patch[key] = null;
    } else if (NUMBER_FIELDS.has(key)) {
      patch[key] = Number(raw);
    } else {
      patch[key] = raw;
    }
  }
  return patch;
}

const DISPLAY_SECTIONS: { titleKey: string; fields: { key: string; labelKey: string }[] }[] = [
  {
    titleKey: "adm_basic",
    fields: [
      { key: "full_name", labelKey: "adm_f_full_name" },
      { key: "date_of_birth", labelKey: "adm_f_dob" },
      { key: "gender", labelKey: "adm_f_gender" },
      { key: "marital_status", labelKey: "adm_f_marital" },
      { key: "caste", labelKey: "caste" },
      { key: "sub_caste", labelKey: "adm_f_subcaste" },
      { key: "gothram", labelKey: "gothram" },
      { key: "mother_tongue", labelKey: "mother_tongue" },
      { key: "height_cm", labelKey: "height" },
      { key: "weight_kg", labelKey: "weight" },
      { key: "birth_time", labelKey: "birth_time" },
      { key: "birth_place", labelKey: "birth_place" },
    ],
  },
  {
    titleKey: "adm_contact_info",
    fields: [
      { key: "email", labelKey: "adm_f_email" },
      { key: "phone", labelKey: "adm_f_phone" },
      { key: "whatsapp", labelKey: "adm_f_whatsapp" },
      { key: "city", labelKey: "adm_f_city" },
      { key: "native_district", labelKey: "adm_f_district" },
      { key: "state", labelKey: "state" },
      { key: "pincode", labelKey: "pincode" },
      { key: "address_line", labelKey: "address" },
    ],
  },
  {
    titleKey: "adm_education",
    fields: [
      { key: "education_level", labelKey: "adm_f_education" },
      { key: "education_detail", labelKey: "education_detail" },
      { key: "profession", labelKey: "adm_f_profession" },
      { key: "job_detail", labelKey: "job_detail" },
      { key: "annual_income", labelKey: "income" },
      { key: "about", labelKey: "adm_f_about" },
    ],
  },
  {
    titleKey: "adm_family",
    fields: [
      { key: "family_type", labelKey: "family_type" },
      { key: "family_status", labelKey: "family_status" },
      { key: "father_name", labelKey: "father_name" },
      { key: "father_occupation", labelKey: "father_occ" },
      { key: "mother_name", labelKey: "mother_name" },
      { key: "mother_occupation", labelKey: "mother_occ" },
      { key: "brothers", labelKey: "brothers" },
      { key: "sisters", labelKey: "sisters" },
      { key: "family_details", labelKey: "adm_f_family" },
    ],
  },
  {
    titleKey: "adm_prefs",
    fields: [
      { key: "pref_age", labelKey: "pref_age" },
      { key: "pref_height_min_cm", labelKey: "pref_height" },
      { key: "pref_education", labelKey: "education_level" },
      { key: "pref_marital_status", labelKey: "marital_status" },
      { key: "pref_sub_caste", labelKey: "sub_caste" },
      { key: "pref_profession", labelKey: "profession" },
      { key: "pref_district", labelKey: "district" },
      { key: "pref_notes", labelKey: "adm_f_prefs" },
    ],
  },
];

const EDIT_SECTION_FIELDS: { titleKey: string; keys: string[] }[] = [
  {
    titleKey: "adm_basic",
    keys: ["full_name", "date_of_birth", "gender", "marital_status", "caste", "sub_caste", "gothram", "mother_tongue", "height_cm", "weight_kg", "birth_time", "birth_place"],
  },
  {
    titleKey: "adm_contact_info",
    keys: ["phone", "whatsapp", "city", "native_district", "state", "pincode", "address_line"],
  },
  {
    titleKey: "adm_education",
    keys: ["education_level", "education_detail", "profession", "job_detail", "annual_income", "about"],
  },
  {
    titleKey: "adm_family",
    keys: ["family_type", "family_status", "father_name", "father_occupation", "mother_name", "mother_occupation", "brothers", "sisters", "family_details"],
  },
  {
    titleKey: "adm_prefs",
    keys: ["pref_age_min", "pref_age_max", "pref_height_min_cm", "pref_education", "pref_marital_status", "pref_sub_caste", "pref_profession", "pref_district", "pref_notes"],
  },
];
function auditLabel(a: ProfileAudit, t: (k: string) => string) {
  if (a.action === "admin_created") return t("audit_admin_created");
  if (a.action === "admin_updated_on_behalf") return t("audit_admin_updated_on_behalf");
  if (a.action === "admin_updated") return t("audit_admin_updated_direct");
  return a.action;
}

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
  const { t, lang } = useI18n();
  const [audit, setAudit] = useState<ProfileAudit[]>([]);
  const [clientReq, setClientReq] = useState<ClientRequest | null>(null);
  const [phoneCountries, setPhoneCountries] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [divorceFile, setDivorceFile] = useState<File | null>(null);
  const [idKind, setIdKind] = useState("Aadhaar");

  const docs = d.docs.filter((x) => x.user_id === profile.id);
  const payment = d.payments.find((x) => x.user_id === profile.id);
  const isClientCreated = profile.profile_created_by !== "admin";
  const clientConfirmed = !isClientCreated || (clientReq?.hasClientConfirmation ?? false);
  const messagesHref = (lang === "ta" ? "/tn" : "/en") + "/admin/messages";
  const needsDivorceDoc =
    form["marital_status"] === "Divorced" || form["marital_status"] === "Widowed";

  useEffect(() => {
    void d.loadAudit(profile.id).then(setAudit);
    void d.loadClientRequest(profile.id).then(setClientReq);
  }, [d, profile.id]);

  useEffect(() => {
    const govtDoc = docs.find((x) => x.doc_type === "govt_id");
    if (govtDoc?.id_kind) setIdKind(govtDoc.id_kind);
  }, [profile.id, docs]);

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
    const countries: Record<string, string> = {};
    for (const key of ALL_FIELD_KEYS) {
      const value = (profile as unknown as Record<string, unknown>)[key];
      if (value === null || value === undefined) {
        next[key] = "";
        continue;
      }
      const kind = EDIT_FIELDS[key]?.kind;
      if (key === "phone" || key === "whatsapp") {
        const split = splitInternationalPhone(value as string | number | null | undefined);
        next[key] = split.local;
        countries[key] = split.iso;
      } else if (key === "birth_time") {
        next[key] = birthTimeToInputValue(value as string | number | null | undefined);
      } else if (kind === "date") {
        next[key] = String(value).slice(0, 10);
      } else {
        next[key] = String(value);
      }
    }
    setForm(next);
    setPhoneCountries(countries);
  }, [profile]);

  async function startEdit() {
    if (!clientConfirmed) {
      toast.error(t("adm_confirm_required"));
      return;
    }
    setEditing(true);
  }

  async function save() {
    if (!clientConfirmed) {
      toast.error(t("adm_confirm_required"));
      return;
    }
    setSaving(true);
    try {
      const mode: "direct" | "on_behalf" = isClientCreated ? "on_behalf" : "direct";
      const note =
        mode === "on_behalf"
          ? "Admin updated the profile on behalf of the client after client confirmation/request."
          : "Admin updated the profile directly.";

      const photoUp = photo ? await uploadToR2(photo, "photo", profile.id) : null;
      const idUp = idFile ? await uploadToR2(idFile, "govt_id", profile.id) : null;
      const divorceUp = divorceFile
        ? await uploadToR2(divorceFile, "divorce_doc", profile.id)
        : null;

      const patch = buildPatch(form);
      if (photoUp) patch["photo_url"] = photoUp.key;

      for (const key of ["phone", "whatsapp"] as const) {
        const raw = patch[key];
        if (raw == null || raw === "") continue;
        const norm = normalizeInternationalPhone(phoneCountries[key] ?? DEFAULT_COUNTRY_ISO, raw as string);
        if (!norm) {
          toast.error(t("phone_invalid"));
          return;
        }
        patch[key] = norm;
      }
      const rawTime = patch["birth_time"];
      if (rawTime != null && rawTime !== "") {
        const normTime = normalizeBirthTime(rawTime as string);
        if (!normTime) {
          toast.error(t("time_invalid"));
          return;
        }
        patch["birth_time"] = normTime;
      }

      const ok = await d.adminUpdateProfile(
        profile.id,
        patch,
        note,
        mode,
        clientReq?.threadId ?? null,
      );
      if (!ok) return;

      try {
        const rows: {
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
          rows.push({
            user_id: profile.id,
            doc_type: "photo",
            storage_key: photoUp.key,
            file_name: photoUp.fileName,
            mime_type: photoUp.mimeType,
            size_bytes: photoUp.sizeBytes,
            ai_check_status: "not_run",
          });
        }
        if (idUp) {
          rows.push({
            user_id: profile.id,
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
          rows.push({
            user_id: profile.id,
            doc_type: "divorce_doc",
            storage_key: divorceUp.key,
            file_name: divorceUp.fileName,
            mime_type: divorceUp.mimeType,
            size_bytes: divorceUp.sizeBytes,
            ai_check_status: "not_run",
          });
        }
        if (rows.length > 0) {
          const { error } = await supabase.from("documents").insert(rows);
          if (error) throw error;
        }
      } catch (err) {
        toast.warning(
          err instanceof Error ? `${t("adm_saved")} — ${err.message}` : t("adm_upload_failed"),
        );
      }

      toast.success(t("adm_saved"));
      setEditing(false);
      setPhoto(null);
      setIdFile(null);
      setDivorceFile(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
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
          <StatusBadge tone={isProfileDraft(profile) ? "neutral" : toneForStatus(profile.status)}>
            {isProfileDraft(profile) ? t("st_draft") : statusLabel(t, profile.status)}
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
              <Row label={t("adm_profile_id")} value={profile.client_profile_id ?? "—"} />
              <Row label={t("adm_plan")} value={planLabel(t, profile.membership_plan)} />
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
            </div>
            </div>

          {DISPLAY_SECTIONS.map((section) => (
            <section key={section.titleKey} className="space-y-1">
              <h3 className="border-b border-border pb-1 pt-2 text-sm font-medium text-primary">
                {t(section.titleKey)}
              </h3>
              <div className="grid gap-1 sm:grid-cols-2">
                {section.fields.map((f) => (
                  <Row key={f.key} label={t(f.labelKey)} value={displayValue(profile, f.key)} />
                ))}
              </div>
            </section>
          ))}
          {isClientCreated && (
            <section className="space-y-1 rounded-lg border border-border bg-card/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{t("adm_client_request_title")}</h3>
                <a href={messagesHref} className="text-xs text-primary hover:underline">
                  {t("adm_open_messages")}
                </a>
              </div>
              {clientConfirmed ? (
                <>
                  <p className="text-sm font-medium">{t("adm_client_request_present")}</p>
                  {clientReq?.latestClientBody && (
                    <p className="rounded-lg bg-muted px-2 py-1 text-sm text-muted-foreground">
                      “{clientReq.latestClientBody}”
                    </p>
                  )}
                  {clientReq?.latestClientAt && (
                    <p className="text-xs text-muted-foreground">
                      {new Date(clientReq.latestClientAt).toLocaleString()}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("adm_no_client_request")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-destructive">* </span>
                    {t("adm_client_request_missing_d")}
                  </p>
                </>
              )}
            </section>
          )}

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
                    {new Date(a.created_at).toLocaleString()} — {auditLabel(a, t)}
                    {a.details ? ` (${a.details})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {editing && EDIT_SECTION_FIELDS.map((section) => (
            <section key={section.titleKey} className="space-y-1">
              <h3 className="border-b border-border pb-1 pt-2 text-sm font-medium text-primary">
                {t(section.titleKey)}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {section.keys.map((key) => {
                  const ef = EDIT_FIELDS[key];
                  if (!ef) return null;
                  return (
                    <div key={key} className={ef.full ? "sm:col-span-2" : ""}>
                      <EditField
                        field={ef}
                        value={form[key] ?? ""}
                        onChange={(v) => setForm((s) => ({ ...s, [key]: v }))}
                        iso={phoneCountries[key] ?? DEFAULT_COUNTRY_ISO}
                        onIsoChange={(c) => setPhoneCountries((s) => ({ ...s, [key]: c }))}
                        t={t}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {editing && (
            <section className="space-y-4">
              <h3 className="border-b border-border pb-1 pt-2 text-sm font-medium text-primary">
                {t("adm_upload_docs")}
              </h3>
              <FileField label={t("photo")} accept="image/*" file={photo} onFile={setPhoto} />
              <div>
                <Label className="mb-1.5 block text-sm">{t("id_kind")}</Label>
                <Choice
                  value={idKind}
                  onChange={setIdKind}
                  options={ID_KINDS.map((o) => ({ v: o.v, l: t(o.labelKey) }))}
                />
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
            </section>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          {editing ? (
            <>
              <Button size="sm" disabled={saving || d.busy} onClick={save}>
                {t("adm_save")}
              </Button>
              <Button size="sm" variant="ghost" disabled={saving || d.busy} onClick={() => setEditing(false)}>
                {t("adm_close_btn")}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" disabled={d.busy} onClick={startEdit}>
                {t("adm_edit_profile")}
              </Button>
              {profile.status !== "approved" && !isProfileDraft(profile) && (
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

function displayValue(profile: AdminProfile, key: string): string | number | null | undefined {
  switch (key) {
    case "birth_time":
      return formatBirthTime(profile.birth_time);
    case "phone":
      return formatPhoneForDisplay(profile.phone);
    case "whatsapp":
      return formatPhoneForDisplay(profile.whatsapp);
    case "pref_age": {
      const min = profile.pref_age_min;
      const max = profile.pref_age_max;
      if (min == null && max == null) return null;
      if (min != null && max != null) return `${min} - ${max}`;
      return min != null ? min : max;
    }
    default:
      return (profile as unknown as Record<string, unknown>)[key] as string | number | null | undefined;
  }
}

function EditField({
  field,
  value,
  onChange,
  iso,
  onIsoChange,
  t,
}: {
  field: EditField;
  value: string;
  onChange: (v: string) => void;
  iso?: string;
  onIsoChange?: (iso: string) => void;
  t: (k: string) => string;
}) {
  if (field.kind === "choice") {
    return (
      <div>
        <Label className="mb-1.5 block text-sm">{t(field.labelKey)}</Label>
        <Choice
          value={value}
          onChange={onChange}
          options={(field.options ?? []).map((o) => ({ v: o.v, l: t(o.labelKey) }))}
        />
      </div>
    );
  }
  if (field.kind === "textarea") {
    return (
      <div>
        <span className="mb-1 block text-sm text-muted-foreground">{t(field.labelKey)}</span>
        <Textarea maxLength={field.maxLength} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  if (field.kind === "time") {
    return <TimeInput label={t(field.labelKey)} value={value} onChange={onChange} onBlur={undefined} />;
  }
  if (field.kind === "phone") {
    return (
      <CountryCodePhoneField
        label={t(field.labelKey)}
        iso={iso ?? DEFAULT_COUNTRY_ISO}
        local={value}
        onIsoChange={(c) => onIsoChange?.(c)}
        onLocalChange={onChange}
        onLocalBlur={undefined}
      />
    );
  }
  return (
    <div>
      <span className="mb-1 block text-sm text-muted-foreground">{t(field.labelKey)}</span>
      <Input
        type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"}
        maxLength={field.maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Choice({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
            value === o.v
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border hover:bg-accent/20"
          }`}
        >
          {o.l}
        </button>
      ))}
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