import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { createClientProfile } from "@/lib/admin-profiles.functions";
import { uploadToR2 } from "@/lib/upload";
import { formatBytes, friendlyUploadError } from "@/lib/compress";
import { normalizeInternationalPhone } from "@/lib/phone";
import { DEFAULT_COUNTRY_ISO } from "@/lib/country-codes";
import { normalizeBirthTime } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import {
  CASTE_OPTIONS,
  COURSES_BY_LEVEL,
  COURSE_OTHER,
  EDUCATION_LEVELS,
  FAMILY_STATUSES,
  FAMILY_TYPES,
  GENDERS,
  ID_KINDS,
  MARITAL_STATUSES,
  type ProfileOption,
} from "@/lib/profile-options";
import { LookupSelect } from "@/components/LookupSelect";
import { TimeInput } from "@/components/TimeInput";
import { CountryCodePhoneField } from "@/components/CountryCodePhoneField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload } from "lucide-react";

type LookupCategory = "sub_caste" | "profession" | "native_district" | "occupation" | "gothram" | "mother_tongue";

type FieldDef =
  | { kind: "input"; key: string; labelKey: string; type?: string; min?: number; full?: boolean }
  | { kind: "phone"; key: string; labelKey: string; full?: boolean }
  | { kind: "time"; key: string; labelKey: string; full?: boolean }
  | { kind: "textarea"; key: string; labelKey: string; full?: boolean }
  | { kind: "choice"; key: string; labelKey: string; options: ProfileOption[]; full?: boolean }
  | { kind: "course"; key: string; labelKey: string; full?: boolean }
  | {
      kind: "lookup";
      key: string;
      labelKey: string;
      category: LookupCategory;
      anyLabel?: string;
      includeOther?: boolean;
      full?: boolean;
    };

const SECTIONS: { titleKey: string; fields: FieldDef[] }[] = [
  {
    titleKey: "adm_basic",
    fields: [
      { kind: "input", key: "full_name", labelKey: "adm_f_full_name" },
      { kind: "input", key: "email", labelKey: "adm_f_email" },
      { kind: "choice", key: "gender", labelKey: "adm_f_gender", options: GENDERS },
      { kind: "input", key: "date_of_birth", labelKey: "adm_f_dob", type: "date" },
      { kind: "choice", key: "marital_status", labelKey: "adm_f_marital", options: MARITAL_STATUSES },
      { kind: "choice", key: "caste", labelKey: "caste", options: CASTE_OPTIONS },
      { kind: "lookup", key: "sub_caste", labelKey: "adm_f_subcaste", category: "sub_caste" },
      { kind: "lookup", key: "gothram", labelKey: "gothram", category: "gothram", includeOther: true },
      { kind: "lookup", key: "mother_tongue", labelKey: "mother_tongue", category: "mother_tongue", includeOther: true },
      { kind: "input", key: "height_cm", labelKey: "height", type: "number" },
      { kind: "input", key: "weight_kg", labelKey: "weight", type: "number" },
      { kind: "time", key: "birth_time", labelKey: "birth_time" },
      { kind: "input", key: "birth_place", labelKey: "birth_place" },
    ],
  },
  {
    titleKey: "adm_contact_info",
    fields: [
      { kind: "phone", key: "phone", labelKey: "adm_f_phone" },
      { kind: "phone", key: "whatsapp", labelKey: "adm_f_whatsapp" },
      { kind: "input", key: "city", labelKey: "adm_f_city" },
      { kind: "lookup", key: "native_district", labelKey: "adm_f_district", category: "native_district" },
      { kind: "textarea", key: "address_line", labelKey: "address", full: true },
      { kind: "input", key: "state", labelKey: "state" },
      { kind: "input", key: "pincode", labelKey: "pincode" },
    ],
  },
  {
    titleKey: "adm_education",
    fields: [
      { kind: "choice", key: "education_level", labelKey: "adm_f_education", options: EDUCATION_LEVELS },
      { kind: "course", key: "education_detail", labelKey: "education_detail", full: true },
      { kind: "lookup", key: "profession", labelKey: "adm_f_profession", category: "profession" },
      { kind: "input", key: "job_detail", labelKey: "job_detail" },
      { kind: "input", key: "annual_income", labelKey: "income" },
      { kind: "textarea", key: "about", labelKey: "adm_f_about", full: true },
    ],
  },
  {
    titleKey: "adm_family",
    fields: [
      { kind: "choice", key: "family_type", labelKey: "family_type", options: FAMILY_TYPES },
      { kind: "choice", key: "family_status", labelKey: "family_status", options: FAMILY_STATUSES },
      { kind: "input", key: "father_name", labelKey: "father_name" },
      { kind: "lookup", key: "father_occupation", labelKey: "father_occ", category: "occupation", includeOther: true },
      { kind: "input", key: "mother_name", labelKey: "mother_name" },
      { kind: "lookup", key: "mother_occupation", labelKey: "mother_occ", category: "occupation", includeOther: true },
      { kind: "input", key: "brothers", labelKey: "brothers", type: "number", min: 0 },
      { kind: "input", key: "sisters", labelKey: "sisters", type: "number", min: 0 },
      { kind: "textarea", key: "family_details", labelKey: "adm_f_family", full: true },
    ],
  },
  {
    titleKey: "adm_prefs",
    fields: [
      { kind: "input", key: "pref_age_min", labelKey: "pref_age_min_label", type: "number" },
      { kind: "input", key: "pref_age_max", labelKey: "pref_age_max_label", type: "number" },
      { kind: "input", key: "pref_height_min_cm", labelKey: "pref_height", type: "number" },
      { kind: "choice", key: "pref_education", labelKey: "education_level", options: EDUCATION_LEVELS },
      { kind: "choice", key: "pref_marital_status", labelKey: "marital_status", options: MARITAL_STATUSES },
      { kind: "lookup", key: "pref_sub_caste", labelKey: "sub_caste", category: "sub_caste" },
      { kind: "lookup", key: "pref_profession", labelKey: "profession", category: "profession", anyLabel: "any_profession" },
      { kind: "lookup", key: "pref_district", labelKey: "district", category: "native_district" },
      { kind: "textarea", key: "pref_notes", labelKey: "adm_f_prefs", full: true },
    ],
  },
];

const choice = (options: ProfileOption[]) => (t: (k: string) => string) =>
  options.map((o) => ({ v: o.v, l: t(o.labelKey) }));

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
  const [phoneErrors, setPhoneErrors] = useState<Record<string, string>>({});
  const [timeError, setTimeError] = useState("");
  const [phoneCountries, setPhoneCountries] = useState<Record<string, string>>({});

  const needsDivorceDoc =
    form["marital_status"] === "Divorced" || form["marital_status"] === "Widowed";

  const set = (k: string) => (v: string) => setForm((s) => ({ ...s, [k]: v }));

  function handlePhoneBlur(key: string) {
    const raw = form[key] ?? "";
    if (!raw.trim()) {
      setPhoneErrors((s) => ({ ...s, [key]: "" }));
      return;
    }
    if (!normalizeInternationalPhone(phoneCountries[key] ?? DEFAULT_COUNTRY_ISO, raw)) {
      setPhoneErrors((s) => ({ ...s, [key]: t("phone_invalid") }));
    } else {
      setPhoneErrors((s) => ({ ...s, [key]: "" }));
    }
  }

  function handleTimeBlur() {
    const raw = form["birth_time"] ?? "";
    if (!raw.trim()) {
      setTimeError("");
      return;
    }
    if (!normalizeBirthTime(raw)) {
      setTimeError(t("time_invalid"));
    } else {
      setTimeError("");
    }
  }

  async function submit() {
    if (!form["email"]?.trim() || !form["full_name"]?.trim()) {
      toast.error(t("adm_email_required"));
      return;
    }
    if (timeError) {
      toast.error(t("time_invalid"));
      return;
    }
    setBusy(true);
    let profileId: string | null = null;
    try {
      const payload: Record<string, string> = {};
      for (const section of SECTIONS) {
        for (const f of section.fields) {
          const v = form[f.key]?.trim();
          if (v) payload[f.key] = v;
        }
      }
      payload["redirectUrl"] = window.location.origin;

      for (const key of ["phone", "whatsapp"] as const) {
        const raw = payload[key];
        if (!raw) continue;
        const norm = normalizeInternationalPhone(
          phoneCountries[key] ?? DEFAULT_COUNTRY_ISO,
          raw,
        );
        if (!norm) {
          toast.error(t("phone_invalid"));
          return;
        }
        payload[key] = norm;
      }

      const birthTimeRaw = payload["birth_time"];
      if (birthTimeRaw) {
        const normTime = normalizeBirthTime(birthTimeRaw);
        if (!normTime) {
          toast.error(t("time_invalid"));
          return;
        }
        payload["birth_time"] = normTime;
      }

      const res = await createClientProfile({ data: payload as never });
      profileId = res.id;

      const { data: idRow } = await supabase
        .from("profiles")
        .select("client_profile_id")
        .eq("id", profileId)
        .maybeSingle();
      const cpid = (idRow?.client_profile_id as string | null) ?? null;

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
        toast.error(`${t("adm_created_ok")} — ${friendlyUploadError(err, t)}`);
      }

      toast.success(res.existed ? t("adm_exists_updated") : t("adm_created_ok"));
      if (cpid) toast.info(`Profile ID: ${cpid}`);
      if (res.invitation === "sent") toast.info(t("adm_invite_sent"));
      else if (res.invitation === "failed") toast.warning(t("adm_invite_failed"));
      onCreated();
      onClose();
    } catch (err) {
      toast.error(friendlyUploadError(err, t));
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
          {SECTIONS.map((section) => (
            <div key={section.titleKey} className="contents">
              <h3 className="col-span-2 mt-2 border-b border-border pb-1 text-sm font-medium text-primary">
                {t(section.titleKey)}
              </h3>
              {section.fields.map((f) => (
                <div key={f.key} className={f.full ? "sm:col-span-2" : ""}>
                  <FormField
                    field={f}
                    value={form[f.key] ?? ""}
                    onChange={set(f.key)}
                    onPhoneBlur={handlePhoneBlur}
                    phoneError={phoneErrors[f.key] ?? ""}
                    phoneIso={phoneCountries[f.key] ?? DEFAULT_COUNTRY_ISO}
                    onPhoneIso={(c) => setPhoneCountries((s) => ({ ...s, [f.key]: c }))}
                    onTimeBlur={handleTimeBlur}
                    timeError={timeError}
                    onTimeValidity={(invalid) => setTimeError(invalid ? t("time_invalid") : "")}
                    educationLevel={form["education_level"] ?? ""}
                    t={t}
                  />
                </div>
              ))}
            </div>
          ))}

          <div className="sm:col-span-2 space-y-4 border-t border-border pt-3">
            <h3 className="text-sm font-medium text-primary">{t("adm_documents")}</h3>

            <FileField label={t("photo")} accept="image/jpeg,image/png" file={photo} onFile={setPhoto} />
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
            <FileField label={t("govt_id")} accept="image/jpeg,image/png,application/pdf" file={idFile} onFile={setIdFile} />
            {needsDivorceDoc && (
              <FileField
                label={t("divorce_doc")}
                note={t("divorce_doc_note")}
                accept="image/jpeg,image/png,application/pdf"
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

function FormField({
  field,
  value,
  onChange,
  onPhoneBlur,
  phoneError,
  phoneIso,
  onPhoneIso,
  onTimeBlur,
  timeError,
  onTimeValidity,
  educationLevel,
  t,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  onPhoneBlur?: (key: string) => void;
  phoneError?: string;
  phoneIso?: string;
  onPhoneIso?: (iso: string) => void;
  onTimeBlur?: () => void;
  timeError?: string;
  onTimeValidity?: (valid: boolean) => void;
  educationLevel?: string;
  t: (k: string) => string;
}) {
  if (field.kind === "choice") {
    return (
      <div>
        <span className="mb-1 block text-sm text-muted-foreground">{t(field.labelKey)}</span>
        <Choice value={value} onChange={onChange} options={choice(field.options)(t)} />
      </div>
    );
  }
  if (field.kind === "time") {
    return (
      <TimeInput
        label={t(field.labelKey)}
        value={value}
        onChange={onChange}
        onBlur={onTimeBlur}
        error={timeError}
        onValidityChange={onTimeValidity}
      />
    );
  }
  if (field.kind === "phone") {
    return (
      <CountryCodePhoneField
        label={t(field.labelKey)}
        iso={phoneIso ?? DEFAULT_COUNTRY_ISO}
        local={value}
        onIsoChange={(c) => onPhoneIso?.(c)}
        onLocalChange={onChange}
        onLocalBlur={() => {
          onPhoneBlur?.(field.key);
        }}
        error={phoneError}
      />
    );
  }
  if (field.kind === "course") {
    return (
      <CourseField
        label={t(field.labelKey)}
        level={educationLevel ?? ""}
        value={value}
        onChange={onChange}
      />
    );
  }
  if (field.kind === "lookup") {
    return (
      <LookupSelect
        category={field.category}
        label={t(field.labelKey)}
        value={value}
        onChange={onChange}
        anyLabel={field.anyLabel}
        includeOther={field.includeOther}
      />
    );
  }
  if (field.kind === "textarea") {
    return (
      <div>
        <span className="mb-1 block text-sm text-muted-foreground">{t(field.labelKey)}</span>
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  return (
    <div>
      <span className="mb-1 block text-sm text-muted-foreground">{t(field.labelKey)}</span>
      <Input
        type={field.type ?? "text"}
        min={field.min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function CourseField({
  label,
  level,
  value,
  onChange,
}: {
  label: string;
  level: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const options = COURSES_BY_LEVEL[level] ?? [];
  const [other, setOther] = useState(false);

  useEffect(() => {
    setOther(false);
    if (value && !options.some((o) => o.v === value)) {
      onChange("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  useEffect(() => {
    if (value && options.length > 0 && !options.some((o) => o.v === value)) {
      setOther(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, level]);

  if (options.length === 0) return null;

  return (
    <div>
      <span className="mb-1 block text-sm text-muted-foreground">{label}</span>
      <Choice
        value={other ? COURSE_OTHER : value}
        onChange={(v) => {
          if (v === COURSE_OTHER) {
            setOther(true);
            onChange("");
          } else {
            setOther(false);
            onChange(v);
          }
        }}
        options={options}
      />
      {other && (
        <Input
          className="mt-2"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type course"
          maxLength={120}
        />
      )}
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
