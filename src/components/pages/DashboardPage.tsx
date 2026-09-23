import { useEffect, useRef, useState } from "react";
import {
  Clock,
  CheckCircle2,
  XCircle,
  FileEdit,
  Images,
  FileText,
  Plus,
  Trash2,
  ExternalLink,
  Upload,
  Printer,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createViewUrl, deleteUpload } from "@/lib/storage.functions";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { uploadToR2 } from "@/lib/upload";
import {
  friendlyUploadError,
  formatBytes,
  MAX_PHOTOS_PER_PROFILE,
  MAX_PROFILE_STORAGE_BYTES,
} from "@/lib/compress";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { formatPhoneForDisplay } from "@/lib/phone";
import { formatBirthTime } from "@/lib/format";

type Profile = Record<string, string | number | null> & {
  client_profile_id: string | null;
  full_name: string | null;
  status: "pending" | "approved" | "rejected";
  membership_plan: "free" | "standard" | "premium";
  plan_valid_until: string | null;
  admin_notes: string | null;
  submitted_at: string | null;
  photo_url: string | null;
};

type GalleryDoc = {
  id: string;
  user_id: string;
  doc_type: string;
  id_kind: string | null;
  storage_key: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  verified: boolean | null;
  ai_check_status: string | null;
  created_at: string | null;
};

export function DashboardPage() {
  const { t, lang } = useI18n();
  const { isAdmin, roleReady } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [docs, setDocs] = useState<GalleryDoc[]>([]);
  const [viewUrls, setViewUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const registerHref = lang === "ta" ? "/ta/register" : "/register";

  const loadDocs = async (userId: string) => {
    setDocsLoading(true);
    try {
      const { data } = await supabase
        .from("documents")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      const rows = (data ?? []) as GalleryDoc[];
      setDocs(rows);
      const urls: Record<string, string> = {};
      await Promise.all(
        rows.map(async (r) => {
          try {
            const { url } = await createViewUrl({ data: { key: r.storage_key } });
            urls[r.storage_key] = url;
          } catch {
            /* individual file URLs resolve lazily on demand */
          }
        }),
      );
      setViewUrls(urls);
    } finally {
      setDocsLoading(false);
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      const { data: row } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .maybeSingle();
      const p = (row ?? null) as Profile | null;
      setProfile(p);
      setLoading(false);
      await loadDocs(data.user.id);
      const key = p?.photo_url;
      if (key) {
        try {
          const { url } = await createViewUrl({ data: { key } });
          setPhotoUrl(url);
        } catch {
          setPhotoUrl(null);
        }
      }
    });
  }, []);

  const status = profile?.status ?? "pending";
  const submitted = Boolean(profile?.submitted_at);
  const hasSavedData = Boolean(profile?.full_name);

  const photos = docs.filter((x) => x.doc_type === "photo");
  const docRows = docs.filter((x) => x.doc_type !== "photo");
  const usedBytes = docs.reduce((sum, x) => sum + (x.size_bytes ?? 0), 0);

  const v = (k: string) => (profile ? profile[k] : null);

  const present = (x: unknown) =>
    x !== null && x !== undefined && String(x).trim() !== "";

  type SectionRow = { label: string; value: unknown; full?: boolean };

  const keep = (rows: SectionRow[]) => rows.filter((r) => present(r.value));

  const basicRows: SectionRow[] = [
    { label: t("full_name"), value: v("full_name") },
    { label: t("gender"), value: v("gender") },
    { label: t("dob"), value: v("date_of_birth") },
    { label: t("marital_status"), value: v("marital_status") },
    { label: t("caste"), value: v("caste") },
    { label: t("sub_caste"), value: v("sub_caste") },
    { label: t("gothram"), value: v("gothram") },
    { label: t("mother_tongue"), value: v("mother_tongue") },
    {
      label: t("height"),
      value: present(v("height_cm")) ? `${String(v("height_cm"))} cm` : null,
    },
    {
      label: t("weight"),
      value: present(v("weight_kg")) ? `${String(v("weight_kg"))} kg` : null,
    },
    { label: t("birth_time"), value: formatBirthTime(v("birth_time")) },
    { label: t("birth_place"), value: v("birth_place") },
  ];

  const contactCols: SectionRow[][] = [
    [
      { label: t("phone"), value: formatPhoneForDisplay(v("phone")) },
      { label: t("email"), value: v("email") },
      { label: t("address"), value: v("address_line") },
      { label: t("city"), value: v("city") },
      { label: t("state"), value: v("state") },
    ],
    [
      { label: t("whatsapp"), value: formatPhoneForDisplay(v("whatsapp")) },
      { label: t("district"), value: v("native_district") },
      { label: t("pincode"), value: v("pincode") },
    ],
  ];

  const eduRows: SectionRow[] = [
    { label: t("education_level"), value: v("education_level") },
    { label: t("education_detail"), value: v("education_detail") },
    { label: t("profession"), value: v("profession") },
    { label: t("job_detail"), value: v("job_detail") },
    { label: t("income"), value: v("annual_income") },
    { label: t("about"), value: v("about"), full: true },
  ];

  const familyRows: SectionRow[] = [
    { label: t("father_name"), value: v("father_name") },
    { label: t("father_occ"), value: v("father_occupation") },
    { label: t("mother_name"), value: v("mother_name") },
    { label: t("mother_occ"), value: v("mother_occupation") },
    ...(present(v("brothers")) || present(v("sisters"))
      ? [
          { label: t("brothers"), value: v("brothers") },
          { label: t("sisters"), value: v("sisters") },
        ]
      : [{ label: t("siblings"), value: v("siblings") }]),
    { label: t("family_type"), value: v("family_type") },
    { label: t("family_status"), value: v("family_status") },
    { label: t("family_details"), value: v("family_details"), full: true },
  ];

  const prefRows: SectionRow[] = [
    {
      label: t("pref_age"),
      value: (() => {
        const parts = [v("pref_age_min"), v("pref_age_max")].filter((x) => present(x));
        return parts.length ? parts.join(" – ") : null;
      })(),
    },
    { label: t("pref_height"), value: v("pref_height_min_cm") },
    { label: t("marital_status"), value: v("pref_marital_status") },
    { label: t("sub_caste"), value: v("pref_sub_caste") },
    { label: t("education_level"), value: v("pref_education") },
    { label: t("profession"), value: v("pref_profession") },
    { label: t("district"), value: v("pref_district") },
    { label: t("pref_notes"), value: v("pref_notes"), full: true },
  ];

  const sections: { title: string; rows: SectionRow[]; cols?: SectionRow[][] }[] = [
    { title: t("step_basic"), rows: keep(basicRows) },
    {
      title: t("step_contact"),
      rows: [],
      cols: contactCols.map((col) => col.filter((r) => present(r.value))),
    },
    { title: t("step_edu"), rows: keep(eduRows) },
    { title: t("step_family"), rows: keep(familyRows) },
    { title: t("step_pref"), rows: keep(prefRows) },
  ];

  const statusLabel = !submitted
    ? t("draft_saved")
    : t(status === "approved" ? "status_approved" : status === "rejected" ? "status_rejected" : "status_pending");

  const StatusIcon =
    !submitted ? FileEdit : status === "approved" ? CheckCircle2 : status === "rejected" ? XCircle : Clock;

  const openFile = async (key: string) => {
    try {
      const { url } = await createViewUrl({ data: { key } });
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error(friendlyUploadError(err, t));
    }
  };

  const addPhoto = async (file: File) => {
    if (photos.length >= MAX_PHOTOS_PER_PROFILE) {
      toast.error(t("msg_limit_photos"));
      return;
    }
    setUploading(true);
    try {
      const up = await uploadToR2(file, "photo");
      const { error } = await supabase.from("documents").insert({
        user_id: userId ?? (profile?.["id"] as string),
        doc_type: "photo",
        storage_key: up.key,
        file_name: up.fileName,
        mime_type: up.mimeType,
        size_bytes: up.sizeBytes,
        ai_check_status: "not_run",
      });
      if (error) throw error;
      toast.success(t("adm_uploaded"));
      if (userId) await loadDocs(userId);
    } catch (err) {
      toast.error(friendlyUploadError(err, t));
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (doc: GalleryDoc) => {
    const confirmation =
      doc.doc_type === "photo" ? t("remove_confirm_photo") : t("remove_confirm_doc");
    if (!window.confirm(confirmation)) return;
    setRemoving(true);
    try {
      await deleteUpload({ data: { key: doc.storage_key } });
      toast.success(t("delete_ok"));
      if (profile && userId) {
        await loadDocs(userId);
        if (profile.photo_url === doc.storage_key) {
          const { data: row } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .maybeSingle();
          setProfile(row as Profile | null);
          setPhotoUrl(null);
        }
      }
    } catch (err) {
      toast.error(friendlyUploadError(err, t));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="min-h-screen bg-secondary/30 print:bg-white">
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="mx-auto max-w-[840px] px-4 py-8 sm:py-12 print:max-w-full print:px-0 print:py-0">
        {isAdmin ? (
          <>
            <h1 className="font-display text-3xl font-semibold">{t("admin_home_title")}</h1>
            <div className="gold-rule mt-3 w-24" />
            <div className="card-elevated mt-8 p-6">
              <p className="text-sm text-muted-foreground">{t("admin_home_d")}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button asChild>
                  <a href={lang === "ta" ? "/tn/admin" : "/en/admin"}>{t("admin_open_dashboard")}</a>
                </Button>
                <Button asChild variant="secondary">
                  <a href={lang === "ta" ? "/ta/jathagam" : "/jathagam"}>{t("jat_page_title")}</a>
                </Button>
                <Button asChild variant="secondary">
                  <a href={lang === "ta" ? "/tn/admin/messages" : "/en/admin/messages"}>
                    {t("adm_nav_messages")}
                  </a>
                </Button>
              </div>
            </div>
          </>
        ) : loading || !roleReady ? (
          <p className="mt-8 text-sm text-muted-foreground">…</p>
        ) : !submitted && !hasSavedData ? (
          <div className="card-elevated mt-8 p-6">
            <h2 className="font-display text-xl font-semibold">{t("reg_title")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("hero_note")}</p>
            <Button asChild className="mt-4">
              <a href={registerHref}>{t("hero_cta")}</a>
            </Button>
          </div>
        ) : (
          <>
            <div className="print:hidden mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild variant={submitted ? "secondary" : "default"}>
                  <a href={registerHref}>{submitted ? t("edit_profile") : t("continue_reg")}</a>
                </Button>
                <Button type="button" variant="outline" onClick={() => window.print()}>
                  <Printer className="mr-1.5 size-4" />
                  {t("print_profile")}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{t("plans_title")}:</span>
                <span className="font-medium capitalize text-foreground">
                  {profile?.membership_plan}
                </span>
                {profile?.plan_valid_until && (
                  <span>({String(profile.plan_valid_until)})</span>
                )}
              </div>
            </div>

            {profile?.admin_notes && (
              <div className="print:hidden mb-6 rounded-lg border border-border bg-white/70 p-3 text-sm">
                {profile.admin_notes}
              </div>
            )}

            <article className="profile-sheet relative mx-auto max-w-[840px] rounded-lg border border-border bg-white p-6 shadow-soft sm:p-10 print:max-w-full print:p-0">
              <header className="break-inside-avoid border-b border-border/80 pb-6 text-center">
                <h1 className="font-display text-2xl font-semibold text-primary sm:text-3xl">
                  {t("brand")}
                </h1>
                <p className="mt-1.5 font-display text-xl font-semibold text-muted-foreground sm:text-2xl">
                  {t("brand_line2")}
                </p>
                <div className="gold-rule mx-auto mt-3 w-24" />
              </header>

              <div className="mt-6 flex flex-col gap-5 break-inside-avoid sm:flex-row sm:items-center">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt={t("photo")}
                    onError={() => setPhotoUrl(null)}
                    className="size-28 shrink-0 rounded-lg border border-border object-cover sm:size-36"
                  />
                ) : (
                  <div className="flex size-28 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-display text-4xl font-semibold text-primary sm:size-36">
                    {(profile?.full_name ?? "M").trim().charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <h2 className="break-words font-display text-2xl font-semibold leading-tight sm:text-3xl">
                      {profile?.full_name ?? ""}
                    </h2>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/70 px-2.5 py-0.5 text-xs font-medium">
                      <StatusIcon
                        className={
                          !submitted
                            ? "size-3.5 text-warning"
                            : status === "approved"
                              ? "size-3.5 text-success"
                              : status === "rejected"
                                ? "size-3.5 text-destructive"
                                : "size-3.5 text-warning"
                        }
                      />
                      {statusLabel}
                    </span>
                  </div>
                  <dl className="mt-3 space-y-1.5">
                    {present(v("client_profile_id")) && (
                      <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 break-inside-avoid">
                        <dt className="text-xs font-medium text-muted-foreground">
                          {t("adm_profile_id")}
                        </dt>
                        <dd className="text-sm font-medium">{String(v("client_profile_id"))}</dd>
                      </div>
                    )}
                    {present(v("gender")) && (
                      <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 break-inside-avoid">
                        <dt className="text-xs font-medium text-muted-foreground">{t("gender")}</dt>
                        <dd className="text-sm font-medium">{String(v("gender"))}</dd>
                      </div>
                    )}
                    {present(v("marital_status")) && (
                      <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 break-inside-avoid">
                        <dt className="text-xs font-medium text-muted-foreground">
                          {t("marital_status")}
                        </dt>
                        <dd className="text-sm font-medium">{String(v("marital_status"))}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              </div>

              {sections.map((s, i) => {
                const colCount = s.cols?.reduce((n, col) => n + col.length, 0) ?? 0;
                if (s.rows.length === 0 && colCount === 0) return null;
                return (
                  <section key={`${i}-${s.title}`} className="profile-section mt-6">
                    <div className="flex items-center gap-3 break-after-avoid">
                      <h3 className="shrink-0 font-display text-base font-semibold text-primary sm:text-lg">
                        {i + 1}. {s.title}
                      </h3>
                      <div className="gold-rule h-px min-w-8 flex-1 opacity-70" />
                    </div>
                    {s.cols ? (
                      <dl className="mt-4 grid grid-cols-1 gap-y-2.5 text-sm sm:grid-cols-2 sm:gap-x-8">
                        {s.cols.map((col, ci) => (
                          <div key={ci} className="grid content-start gap-y-2.5">
                            {col.map((r) => (
                              <div
                                key={`${r.label}-${String(r.value)}`}
                                className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 break-inside-avoid"
                              >
                                <dt className="text-xs font-medium text-muted-foreground">
                                  {r.label}
                                </dt>
                                <dd className="min-w-0 break-words font-medium">
                                  {String(r.value)}
                                </dd>
                              </div>
                            ))}
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
                        {s.rows.map((r) => (
                          <div
                            key={`${r.label}-${String(r.value)}`}
                            className={`grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 break-inside-avoid ${
                              r.full ? "sm:col-span-2" : ""
                            }`}
                          >
                            <dt className="text-xs font-medium text-muted-foreground">{r.label}</dt>
                            <dd className="font-medium">{String(r.value)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </section>
                );
              })}

              <section className="profile-section break-inside-avoid mt-6">
                <div className="flex items-center gap-3 break-after-avoid">
                  <h3 className="shrink-0 font-display text-base font-semibold text-primary sm:text-lg">
                    6. {t("step_docs")}
                  </h3>
                  <div className="gold-rule h-px min-w-8 flex-1 opacity-70" />
                </div>

                {docsLoading ? (
                  <p className="mt-4 text-sm text-muted-foreground">…</p>
                ) : photos.length === 0 && docRows.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">{t("upl_no_docs")}</p>
                ) : (
                  <div className="mt-4 space-y-6">
                    {photos.length > 0 && (
                      <div className="break-inside-avoid">
                        <div className="flex items-baseline justify-between gap-2">
                          <h4 className="font-display text-sm font-semibold text-foreground sm:text-base">
                            {t("upl_gallery_title")}
                          </h4>
                          <span className="print:hidden text-xs text-muted-foreground">
                            {photos.length} / {MAX_PHOTOS_PER_PROFILE}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3">
                          {photos.map((photo) => (
                            <div
                              key={photo.id}
                              className="relative w-20 shrink-0 break-inside-avoid sm:w-24"
                            >
                              <div className="aspect-[3/4] overflow-hidden rounded-md border border-border">
                                {viewUrls[photo.storage_key] ? (
                                  <img
                                    src={viewUrls[photo.storage_key]}
                                    alt={photo.file_name ?? t("photo")}
                                    className="size-full object-cover"
                                  />
                                ) : (
                                  <div className="flex size-full items-center justify-center bg-secondary/40 text-muted-foreground">
                                    <Images className="size-5" />
                                  </div>
                                )}
                              </div>
                              {profile?.photo_url === photo.storage_key && (
                                <span className="absolute left-1 top-1 rounded-full bg-success px-1.5 py-0.5 text-[9px] font-medium text-white">
                                  {t("upl_primary")}
                                </span>
                              )}
                              <span className="print:hidden absolute right-1 top-1 flex gap-1">
                                <button
                                  type="button"
                                  title={t("adm_view")}
                                  className="rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                                  onClick={() => openFile(photo.storage_key)}
                                >
                                  <ExternalLink className="size-3" />
                                </button>
                                <button
                                  type="button"
                                  title={t("delete")}
                                  className="rounded-full bg-destructive/80 p-1 text-white hover:bg-destructive"
                                  disabled={removing}
                                  onClick={() => removeFile(photo)}
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              </span>
                            </div>
                          ))}
                          {photos.length < MAX_PHOTOS_PER_PROFILE && (
                            <button
                              type="button"
                              className="print:hidden flex aspect-[3/4] w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-sm text-muted-foreground hover:bg-secondary/40 sm:w-24"
                              onClick={() => photoInputRef.current?.click()}
                              disabled={uploading}
                            >
                              {uploading ? (
                                <span className="text-xs">{t("uploading_label")}</span>
                              ) : (
                                <>
                                  <Plus className="size-5" />
                                  <Upload className="size-4" />
                                  <span>{t("upl_add_photo")}</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                        <input
                          ref={photoInputRef}
                          type="file"
                          accept="image/jpeg,image/png"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void addPhoto(f);
                            e.target.value = "";
                          }}
                        />
                        <p className="print:hidden mt-3 text-xs text-muted-foreground">
                          {t("upl_storage_hint")}
                        </p>
                      </div>
                    )}

                    {docRows.length > 0 && (
                      <div className="break-inside-avoid">
                        <h4 className="font-display text-sm font-semibold text-foreground sm:text-base">
                          {t("upl_docs_title")}
                        </h4>
                        <ul className="mt-2 space-y-1.5">
                          {docRows.map((doc) => (
                            <li
                              key={doc.id}
                              className="break-inside-avoid flex items-start justify-between gap-3 rounded-md border border-border p-2.5 text-sm"
                            >
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  className="block max-w-full truncate text-left font-medium text-primary hover:underline"
                                  onClick={() => openFile(doc.storage_key)}
                                >
                                  <FileText className="mr-1 inline size-4 align-[-2px]" />
                                  {doc.file_name ||
                                    `${t("docLabel")}${doc.id_kind ? ` (${doc.id_kind})` : ""}`}
                                </button>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {doc.mime_type ?? "—"} · {formatBytes(doc.size_bytes ?? 0)} ·{" "}
                                  {t("upl_uploaded_on")}{" "}
                                  {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : "—"} ·{" "}
                                  {doc.verified ? t("yes") : t("unverified")}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="print:hidden shrink-0"
                                disabled={removing}
                                onClick={() => removeFile(doc)}
                              >
                                <Trash2 className="mr-1 size-3.5" />
                                {t("delete")}
                              </Button>
                            </li>
                          ))}
                        </ul>
                        <p className="print:hidden mt-3 text-xs text-muted-foreground">
                          {t("upl_storage_used_pre")}: {formatBytes(usedBytes)} /{" "}
                          {formatBytes(MAX_PROFILE_STORAGE_BYTES)}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </article>
          </>
        )}
      </main>
      <div className="print:hidden">
        <SiteFooter />
      </div>
    </div>
  );
}
