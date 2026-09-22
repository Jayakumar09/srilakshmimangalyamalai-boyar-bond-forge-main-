import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Upload, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { LookupSelect } from "@/components/LookupSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { uploadToR2 } from "@/lib/upload";
import { fileToDataUrl, prepareFileUpload, formatBytes, friendlyUploadError } from "@/lib/compress";
import { preScreenDocuments, type PreScreenResult } from "@/lib/verify.functions";
import { notifyProfileSubmitted } from "@/lib/notify.functions";
import { ensureLookupOptions, lookupValueEntries } from "@/lib/lookup-options.functions";
import { CountryCodePhoneField } from "@/components/CountryCodePhoneField";
import { TimeInput } from "@/components/TimeInput";
import { normalizeInternationalPhone, splitInternationalPhone } from "@/lib/phone";
import { DEFAULT_COUNTRY_ISO } from "@/lib/country-codes";
import { isValidBirthTimeStrict } from "@/lib/format";
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

const choice = (options: ProfileOption[]) => (t: (k: string) => string) =>
  options.map((o) => ({ v: o.v, l: t(o.labelKey) }));

type Form = Record<string, string>;

const STEPS = ["step_basic", "step_contact", "step_edu", "step_family", "step_pref", "step_docs"];

export function RegisterWizard() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [divorceFile, setDivorceFile] = useState<File | null>(null);
  const [idKind, setIdKind] = useState("Aadhaar");
  const [ai, setAi] = useState<PreScreenResult | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [existingPhotoKey, setExistingPhotoKey] = useState<string | null>(null);
  const [phoneIso, setPhoneIso] = useState<Record<string, string>>({});
  const [birthError, setBirthError] = useState("");
  const [phoneErrors, setPhoneErrors] = useState<Record<string, string>>({});
  const [courseOther, setCourseOther] = useState(false);

  const legalPrefix = lang === "ta" ? "/ta" : "";

  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const field = (k: string) => ({
    value: form[k] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(k)(e.target.value),
  });

  async function loadProfile() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profile) {
      const next: Form = {};
      const isoNext: Record<string, string> = {};
      Object.entries(profile).forEach(([k, v]) => {
        if (v !== null && v !== undefined) next[k] = String(v);
      });
      for (const key of ["phone", "whatsapp"] as const) {
        const stored = profile[key];
        if (stored != null && stored !== "") {
          const split = splitInternationalPhone(stored);
          next[key] = split.local;
          isoNext[key] = split.iso;
        }
      }
      setForm(next);
      setPhoneIso(isoNext);
      setExistingPhotoKey(profile.photo_url ?? null);
      if (profile.consent_accepted_at) setConsent(true);
    }
  }

  useEffect(() => {
    void loadProfile();
  }, []);

  useEffect(() => {
    const detail = form["education_detail"] ?? "";
    const opts = COURSES_BY_LEVEL[form["education_level"] ?? ""] ?? [];
    if (detail && opts.length && !opts.some((o) => o.v === detail)) {
      setCourseOther(true);
    }
  }, [form["education_level"], form["education_detail"]]);

  /** Persist the typed fields without touching documents, consent or approval status. */
  function profileFields(userId: string, email: string | null) {
    const num = (k: string) => (form[k] ? Number(form[k]) : null);
    const phone = (k: "phone" | "whatsapp") => {
      const raw = form[k];
      if (!raw) return null;
      return (
        normalizeInternationalPhone(phoneIso[k] ?? DEFAULT_COUNTRY_ISO, raw) ?? raw
      );
    };
    return {
      id: userId,
      email,
      full_name: form["full_name"] ?? null,
      gender: form["gender"] ?? null,
      date_of_birth: form["date_of_birth"] || null,
      marital_status: form["marital_status"] ?? null,
      caste: form["caste"] ?? null,
      sub_caste: form["sub_caste"] ?? null,
      gothram: form["gothram"] ?? null,
      mother_tongue: form["mother_tongue"] ?? null,
      height_cm: num("height_cm"),
      weight_kg: num("weight_kg"),
      phone: phone("phone"),
      whatsapp: phone("whatsapp"),
      address_line: form["address_line"] ?? null,
      city: form["city"] ?? null,
      native_district: form["native_district"] ?? null,
      state: form["state"] ?? null,
      pincode: form["pincode"] ?? null,
      education_level: form["education_level"] ?? null,
      education_detail: form["education_detail"] ?? null,
      profession: form["profession"] ?? null,
      job_detail: form["job_detail"] ?? null,
      annual_income: form["annual_income"] ?? null,
      father_name: form["father_name"] ?? null,
      father_occupation: form["father_occupation"] ?? null,
      mother_name: form["mother_name"] ?? null,
      mother_occupation: form["mother_occupation"] ?? null,
      brothers: num("brothers"),
      sisters: num("sisters"),
      family_type: form["family_type"] ?? null,
      family_status: form["family_status"] ?? null,
      family_details: form["family_details"] ?? null,
      pref_age_min: num("pref_age_min"),
      pref_age_max: num("pref_age_max"),
      pref_height_min_cm: num("pref_height_min_cm"),
      pref_marital_status: form["pref_marital_status"] ?? null,
      pref_sub_caste: form["pref_sub_caste"] ?? null,
      pref_education: form["pref_education"] ?? null,
      pref_profession: form["pref_profession"] ?? null,
      pref_district: form["pref_district"] ?? null,
      pref_notes: form["pref_notes"] ?? null,
      birth_time: form["birth_time"] ?? null,
      birth_place: form["birth_place"] ?? null,
      about: form["about"] ?? null,
    };
  }

  function phoneInputBlur(key: "phone" | "whatsapp") {
    const raw = form[key];
    if (!raw || !raw.trim()) {
      setPhoneErrors((s) => ({ ...s, [key]: "" }));
      return;
    }
    if (normalizeInternationalPhone(phoneIso[key] ?? DEFAULT_COUNTRY_ISO, raw)) {
      setPhoneErrors((s) => ({ ...s, [key]: "" }));
    } else {
      setPhoneErrors((s) => ({ ...s, [key]: t("phone_invalid") }));
    }
  }

  function phoneIsoSelect(key: "phone" | "whatsapp") {
    return (iso: string) => {
      setPhoneIso((s) => ({ ...s, [key]: iso }));
      setPhoneErrors((s) => ({ ...s, [key]: "" }));
    };
  }

  function birthInputChange(v: string) {
    if (birthError) setBirthError("");
    set("birth_time")(v);
  }

  function birthValidChange(valid: boolean) {
    setBirthError(valid ? "" : t("time_invalid"));
  }

  async function saveProgress() {
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error(t("msg_signin_again"));
      if (!form["full_name"]?.trim()) throw new Error(t("msg_name_required"));
      const { error } = await supabase
        .from("profiles")
        .upsert(profileFields(user.id, user.email ?? null), { onConflict: "id" });
      if (error) throw error;
      try {
        // Any custom lookup values are persisted once progress is saved.
        await ensureLookupOptions(lookupValueEntries(form));
      } catch {
        /* lookup persistence must never block a progress save */
      }
      await loadProfile();
      toast.success(t("msg_saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("msg_save_failed"));
    } finally {
      setSaving(false);
    }
  }

  const needsDivorceDoc =
    form["marital_status"] === "Divorced" || form["marital_status"] === "Widowed";

  const courseOptions = COURSES_BY_LEVEL[form["education_level"] ?? ""] ?? [];

  async function runAiCheck() {
    if (!photo || !idFile) {
      toast.error(t("msg_upload_both"));
      return;
    }
    setAiBusy(true);
    try {
      const [idC, photoC] = await Promise.all([
        prepareFileUpload(idFile, 0.9),
        prepareFileUpload(photo, 0.9),
      ]);
      if (idC.kind === "pdf" || photoC.kind === "pdf") {
        toast.info(t("msg_pdf_ai_skip"));
        return;
      }
      const [idData, photoData] = await Promise.all([
        fileToDataUrl(idC.file),
        fileToDataUrl(photoC.file),
      ]);
      const result = await preScreenDocuments({
        data: { idImage: idData, photoImage: photoData },
      });
      setAi(result);
      if (result.faceMatch && result.idReadable && result.photoClear) {
        toast.success(t("msg_precheck_pass"));
      } else {
        toast.warning(t("msg_precheck_warn"));
      }
    } catch (err) {
      toast.error(friendlyUploadError(err, t));
    } finally {
      setAiBusy(false);
    }
  }

  async function submitAll() {
    if (!consent) {
      toast.error(t("msg_consent_required"));
      return;
    }

    if (birthError) {
      toast.error(t("time_invalid"));
      return;
    }
    const birth = form["birth_time"];
    if (birth && birth.trim() && !isValidBirthTimeStrict(birth)) {
      setBirthError(t("time_invalid"));
      toast.error(t("time_invalid"));
      return;
    }
    for (const key of ["phone", "whatsapp"] as const) {
      const raw = form[key];
      if (
        raw &&
        raw.trim() &&
        !normalizeInternationalPhone(phoneIso[key] ?? DEFAULT_COUNTRY_ISO, raw)
      ) {
        setPhoneErrors((s) => ({ ...s, [key]: t("phone_invalid") }));
        toast.error(t("phone_invalid"));
        return;
      }
    }
    const firstSubmission = !existingPhotoKey;
    if (firstSubmission && (!photo || !idFile)) {
      toast.error(t("msg_docs_required"));
      return;
    }
    if (firstSubmission && needsDivorceDoc && !divorceFile) {
      toast.error(t("msg_divorce_required"));
      return;
    }
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error(t("msg_signin_again"));

      const photoUp = photo ? await uploadToR2(photo, "photo") : null;
      const idUp = idFile ? await uploadToR2(idFile, "govt_id") : null;
      const divorceUp = divorceFile ? await uploadToR2(divorceFile, "divorce_doc") : null;

      const { error: profileError } = await supabase.from("profiles").upsert(
        {
          ...profileFields(user.id, user.email ?? null),
          photo_url: photoUp?.key ?? existingPhotoKey,
          status: "pending",
          consent_accepted_at: new Date().toISOString(),
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (profileError) throw profileError;

      try {
        // Only after a successful profile save: persist any custom lookup values
        // (Other / "Add new") so future members see them in the same dropdown.
        await ensureLookupOptions(lookupValueEntries(form));
      } catch {
        /* lookup persistence must never block a successful submission */
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
        ai_check_notes: string | null;
        ai_face_match_score: number | null;
      }[] = [];
      if (photoUp) {
        docs.push({
          user_id: user.id,
          doc_type: "photo",
          storage_key: photoUp.key,
          file_name: photoUp.fileName,
          mime_type: photoUp.mimeType,
          size_bytes: photoUp.sizeBytes,
          ai_check_status: ai ? (ai.photoClear ? "pass" : "review") : "not_run",
          ai_check_notes: ai?.notes ?? null,
          ai_face_match_score: ai?.faceMatchConfidence ?? null,
        });
      }
      if (idUp) {
        docs.push({
          user_id: user.id,
          doc_type: "govt_id",
          id_kind: idKind,
          storage_key: idUp.key,
          file_name: idUp.fileName,
          mime_type: idUp.mimeType,
          size_bytes: idUp.sizeBytes,
          ai_check_status: ai ? (ai.faceMatch && ai.idReadable ? "pass" : "review") : "not_run",
          ai_check_notes: ai?.notes ?? null,
          ai_face_match_score: ai?.faceMatchConfidence ?? null,
        });
      }
      if (divorceUp) {
        docs.push({
          user_id: user.id,
          doc_type: "divorce_doc",
          storage_key: divorceUp.key,
          file_name: divorceUp.fileName,
          mime_type: divorceUp.mimeType,
          size_bytes: divorceUp.sizeBytes,
          ai_check_status: "not_run",
          ai_check_notes: null,
          ai_face_match_score: null,
        });
      }
      if (docs.length > 0) {
        const { error: docError } = await supabase.from("documents").insert(docs);
        if (docError) throw docError;
      }

      await loadProfile();

      try {
        await notifyProfileSubmitted({
          data: {
            fullName: form["full_name"] ?? "Member",
            memberEmail: user.email ?? "",
          },
        });
      } catch {
        /* alerting must never block a submission */
      }

      toast.success(t("msg_submitted"));
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(friendlyUploadError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-display text-3xl font-semibold">{t("reg_title")}</h1>
        <div className="gold-rule mt-3 w-24" />

        <div className="mt-6 flex flex-wrap gap-2">
          {STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(i)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                i === step
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {i + 1}. {t(s)}
            </button>
          ))}
        </div>

        <div className="card-elevated mt-6 space-y-4 p-6">
          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled label={t("full_name")} required>
                <Input {...field("full_name")} maxLength={100} />
              </Labeled>
              <Labeled label={t("gender")} required>
                <Choice
                  value={form["gender"] ?? ""}
                  onChange={set("gender")}
                  options={choice(GENDERS)(t)}
                />
              </Labeled>
              <Labeled label={t("dob")} required>
                <Input type="date" {...field("date_of_birth")} />
              </Labeled>
              <Labeled label={t("marital_status")} required>
                <Choice
                  value={form["marital_status"] ?? ""}
                  onChange={set("marital_status")}
                  options={choice(MARITAL_STATUSES)(t)}
                />
              </Labeled>
              <Labeled label={t("caste")} required>
                <Choice
                  value={form["caste"] ?? ""}
                  onChange={set("caste")}
                  options={choice(CASTE_OPTIONS)(t)}
                />
              </Labeled>
              <LookupSelect
                category="sub_caste"
                label={t("sub_caste")}
                value={form["sub_caste"] ?? ""}
                onChange={set("sub_caste")}
                required
                includeOther
              />
              <LookupSelect
                category="gothram"
                label={t("gothram")}
                value={form["gothram"] ?? ""}
                onChange={set("gothram")}
                includeOther
              />
              <LookupSelect
                category="mother_tongue"
                label={t("mother_tongue")}
                value={form["mother_tongue"] ?? ""}
                onChange={set("mother_tongue")}
                includeOther
              />
              <Labeled label={t("height")}>
                <Input type="number" {...field("height_cm")} />
              </Labeled>
              <Labeled label={t("weight")}>
                <Input type="number" {...field("weight_kg")} />
              </Labeled>
              <TimeInput
                label={t("birth_time")}
                value={form["birth_time"] ?? ""}
                onChange={birthInputChange}
                error={birthError}
                onValidityChange={birthValidChange}
              />
              <Labeled label={t("birth_place")}>
                <Input {...field("birth_place")} maxLength={100} />
              </Labeled>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled label={t("phone")} required>
                <CountryCodePhoneField
                  label={t("phone")}
                  iso={phoneIso["phone"] ?? DEFAULT_COUNTRY_ISO}
                  onIsoChange={phoneIsoSelect("phone")}
                  local={form["phone"] ?? ""}
                  onLocalChange={set("phone")}
                  onLocalBlur={() => phoneInputBlur("phone")}
                  error={phoneErrors["phone"] ?? ""}
                  placeholder="98765 43210"
                />
              </Labeled>
              <Labeled label={t("whatsapp")}>
                <CountryCodePhoneField
                  label={t("whatsapp")}
                  iso={phoneIso["whatsapp"] ?? DEFAULT_COUNTRY_ISO}
                  onIsoChange={phoneIsoSelect("whatsapp")}
                  local={form["whatsapp"] ?? ""}
                  onLocalChange={set("whatsapp")}
                  onLocalBlur={() => phoneInputBlur("whatsapp")}
                  error={phoneErrors["whatsapp"] ?? ""}
                  placeholder="98765 43210"
                />
              </Labeled>
              <Labeled label={t("address")} full>
                <Textarea {...field("address_line")} maxLength={300} />
              </Labeled>
              <Labeled label={t("city")}>
                <Input {...field("city")} maxLength={80} />
              </Labeled>
              <LookupSelect
                category="native_district"
                label={t("district")}
                value={form["native_district"] ?? ""}
                onChange={set("native_district")}
              />
              <Labeled label={t("state")}>
                <Input {...field("state")} maxLength={80} />
              </Labeled>
              <Labeled label={t("pincode")}>
                <Input {...field("pincode")} maxLength={10} />
              </Labeled>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled label={t("education_level")} required>
                <Choice
                  value={form["education_level"] ?? ""}
                  onChange={(v) => {
                    set("education_level")(v);
                    setCourseOther(false);
                    const detail = form["education_detail"];
                    const next = COURSES_BY_LEVEL[v] ?? [];
                    if (detail && !next.some((o) => o.v === detail)) {
                      setForm((f) => ({ ...f, education_detail: "" }));
                    }
                  }}
                  options={choice(EDUCATION_LEVELS)(t)}
                />
              </Labeled>
              {courseOptions.length > 0 && (
                <Labeled label={t("education_detail")} full>
                  <Choice
                    value={courseOther ? COURSE_OTHER : form["education_detail"] ?? ""}
                    onChange={(v) => {
                      if (v === COURSE_OTHER) {
                        setCourseOther(true);
                        setForm((f) => ({ ...f, education_detail: "" }));
                      } else {
                        setCourseOther(false);
                        setForm((f) => ({ ...f, education_detail: v }));
                      }
                    }}
                    options={courseOptions}
                  />
                  {courseOther && (
                    <Input
                      className="mt-2"
                      value={form["education_detail"] ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, education_detail: e.target.value }))
                      }
                      placeholder={t("type_to_add")}
                      maxLength={120}
                    />
                  )}
                </Labeled>
              )}
              <LookupSelect
                category="profession"
                label={t("profession")}
                value={form["profession"] ?? ""}
                onChange={set("profession")}
                includeOther
              />
              <LookupSelect
                category="job_details"
                label={t("job_detail")}
                value={form["job_detail"] ?? ""}
                onChange={set("job_detail")}
                includeOther
              />
              <Labeled label={t("income")}>
                <Input {...field("annual_income")} maxLength={60} />
              </Labeled>
              <Labeled label={t("about")} full>
                <Textarea {...field("about")} maxLength={800} />
              </Labeled>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled label={t("father_name")}>
                <Input {...field("father_name")} maxLength={100} />
              </Labeled>
              <LookupSelect
                category="occupation"
                label={t("father_occ")}
                value={form["father_occupation"] ?? ""}
                onChange={set("father_occupation")}
                includeOther
              />
              <Labeled label={t("mother_name")}>
                <Input {...field("mother_name")} maxLength={100} />
              </Labeled>
              <LookupSelect
                category="occupation"
                label={t("mother_occ")}
                value={form["mother_occupation"] ?? ""}
                onChange={set("mother_occupation")}
                includeOther
              />
              <Labeled label={t("brothers")}>
                <Input type="number" min={0} {...field("brothers")} />
              </Labeled>
              <Labeled label={t("sisters")}>
                <Input type="number" min={0} {...field("sisters")} />
              </Labeled>
              <Labeled label={t("family_type")}>
                <Choice
                  value={form["family_type"] ?? ""}
                  onChange={set("family_type")}
                  options={choice(FAMILY_TYPES)(t)}
                />
              </Labeled>
              <Labeled label={t("family_status")}>
                <Choice
                  value={form["family_status"] ?? ""}
                  onChange={set("family_status")}
                  options={choice(FAMILY_STATUSES)(t)}
                />
              </Labeled>
              <Labeled label={t("family_details")} full>
                <Textarea {...field("family_details")} maxLength={500} />
              </Labeled>
            </div>
          )}

          {step === 4 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled label={`${t("pref_age")} (${t("min_label")})`}>
                <Input type="number" {...field("pref_age_min")} />
              </Labeled>
              <Labeled label={`${t("pref_age")} (${t("max_label")})`}>
                <Input type="number" {...field("pref_age_max")} />
              </Labeled>
              <Labeled label={t("pref_height")}>
                <Input type="number" {...field("pref_height_min_cm")} />
              </Labeled>
              <Labeled label={t("marital_status")}>
                <Choice
                  value={form["pref_marital_status"] ?? ""}
                  onChange={set("pref_marital_status")}
                  options={choice(MARITAL_STATUSES)(t)}
                />
              </Labeled>
              <LookupSelect
                category="sub_caste"
                label={t("sub_caste")}
                value={form["pref_sub_caste"] ?? ""}
                onChange={set("pref_sub_caste")}
              />
              <Labeled label={t("education_level")}>
                <Choice
                  value={form["pref_education"] ?? ""}
                  onChange={set("pref_education")}
                  options={choice(EDUCATION_LEVELS)(t)}
                />
              </Labeled>
              <LookupSelect
                category="profession"
                label={t("profession")}
                value={form["pref_profession"] ?? ""}
                onChange={set("pref_profession")}
                anyLabel="any_profession"
                includeOther
              />
              <LookupSelect
                category="native_district"
                label={t("district")}
                value={form["pref_district"] ?? ""}
                onChange={set("pref_district")}
              />
              <Labeled label={t("pref_notes")} full>
                <Textarea {...field("pref_notes")} maxLength={500} />
              </Labeled>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-5">
              <FileField
                label={t("photo")}
                required
                accept="image/jpeg,image/png"
                file={photo}
                onFile={setPhoto}
                placeholder={t("choose_file")}
                note={t("upl_photo_hint")}
              />
              <div>
                <Label className="mb-1.5 block text-sm">{t("id_kind")}</Label>
                <Choice
                  value={idKind}
                  onChange={setIdKind}
                  options={choice(ID_KINDS)(t)}
                />
              </div>
              <FileField
                label={t("govt_id")}
                required
                accept="image/jpeg,image/png,application/pdf"
                file={idFile}
                onFile={setIdFile}
                placeholder={t("choose_file")}
                note={t("upl_docs_hint")}
              />
              {needsDivorceDoc && (
                <FileField
                  label={t("divorce_doc")}
                  required
                  note={t("divorce_doc_note")}
                  accept="image/jpeg,image/png,application/pdf"
                  file={divorceFile}
                  onFile={setDivorceFile}
                  placeholder={t("choose_file")}
                />
              )}

              <p className="text-xs text-muted-foreground">{t("upl_storage_hint")}</p>

              <div className="rounded-lg border border-border bg-secondary/40 p-4">
                <Button type="button" variant="secondary" onClick={runAiCheck} disabled={aiBusy}>
                  {aiBusy ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-2 size-4" />
                  )}
                  {aiBusy ? t("ai_running") : t("ai_check")}
                </Button>
                {ai && (
                  <ul className="mt-3 space-y-1 text-sm">
                    <li>
                      {t("ai_face_match")}: <strong>{ai.faceMatch ? t("yes") : t("no")}</strong> (
                      {Math.round((ai.faceMatchConfidence ?? 0) * 100)}%)
                    </li>
                    <li>
                      {t("ai_id_readable")}: {ai.idReadable ? t("yes") : t("no")}
                    </li>
                    <li>
                      {t("ai_photo_clear")}: {ai.photoClear ? t("yes") : t("no")}
                    </li>
                    <li className="text-muted-foreground">{ai.notes}</li>
                  </ul>
                )}
              </div>

              <label className="flex items-start gap-3 text-sm">
                <Checkbox
                  checked={consent}
                  onCheckedChange={(v) => setConsent(v === true)}
                  className="mt-0.5"
                />
                <span>
                  {t("consent")}{" "}
                  <a href={`${legalPrefix}/terms`} className="underline">
                    {t("terms")}
                  </a>
                  ,{" "}
                  <a href={`${legalPrefix}/privacy`} className="underline">
                    {t("privacy")}
                  </a>
                  ,{" "}
                  <a href={`${legalPrefix}/refund-policy`} className="underline">
                    {t("refund")}
                  </a>
                </span>
              </label>

              <Button onClick={submitAll} disabled={busy} className="w-full" size="lg">
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                {t("submit_review")}
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              {t("back")}
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" disabled={saving} onClick={saveProgress}>
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                {t("save")}
              </Button>
              {step < STEPS.length - 1 && (
                <Button type="button" onClick={() => setStep((s) => s + 1)}>
                  {t("next")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Labeled({
  label,
  children,
  required,
  full,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <Label className="mb-1.5 block text-sm">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
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
  required,
  note,
  placeholder,
}: {
  label: string;
  file: File | null;
  onFile: (f: File | null) => void;
  accept: string;
  required?: boolean;
  note?: string;
  placeholder: string;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-sm">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm hover:bg-accent/10">
        <Upload className="size-4 text-primary" />
        <span className="text-muted-foreground">
          {file ? `${file.name} · ${formatBytes(file.size)}` : placeholder}
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
