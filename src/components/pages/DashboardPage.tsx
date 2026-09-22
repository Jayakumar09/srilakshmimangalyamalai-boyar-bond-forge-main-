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

  const rows: { label: string; value: unknown }[] = profile
    ? [
        { label: t("adm_profile_id"), value: v("client_profile_id") },
        { label: t("full_name"), value: v("full_name") },
        { label: t("gender"), value: v("gender") },
        { label: t("dob"), value: v("date_of_birth") },
        { label: t("marital_status"), value: v("marital_status") },
        { label: t("caste"), value: v("caste") },
        { label: t("sub_caste"), value: v("sub_caste") },
        { label: t("gothram"), value: v("gothram") },
        { label: t("mother_tongue"), value: v("mother_tongue") },
        { label: t("height"), value: v("height_cm") },
        { label: t("weight"), value: v("weight_kg") },
        { label: t("phone"), value: formatPhoneForDisplay(v("phone")) },
        { label: t("whatsapp"), value: formatPhoneForDisplay(v("whatsapp")) },
        { label: t("address"), value: v("address_line") },
        { label: t("city"), value: v("city") },
        { label: t("district"), value: v("native_district") },
        { label: t("state"), value: v("state") },
        { label: t("pincode"), value: v("pincode") },
        { label: t("education_level"), value: v("education_level") },
        { label: t("education_detail"), value: v("education_detail") },
        { label: t("profession"), value: v("profession") },
        { label: t("job_detail"), value: v("job_detail") },
        { label: t("income"), value: v("annual_income") },
        { label: t("father_name"), value: v("father_name") },
        { label: t("father_occ"), value: v("father_occupation") },
        { label: t("mother_name"), value: v("mother_name") },
        { label: t("mother_occ"), value: v("mother_occupation") },
        ...(profile["brothers"] !== null || profile["sisters"] !== null
          ? [
              { label: t("brothers"), value: v("brothers") },
              { label: t("sisters"), value: v("sisters") },
            ]
          : [{ label: t("siblings"), value: v("siblings") }]),
        { label: t("family_type"), value: v("family_type") },
        { label: t("family_status"), value: v("family_status") },
        { label: t("family_details"), value: v("family_details") },
        { label: t("birth_time"), value: formatBirthTime(v("birth_time")) },
        { label: t("birth_place"), value: v("birth_place") },
        { label: t("about"), value: v("about") },
      ].filter((r) => r.value !== null && r.value !== undefined && String(r.value).trim() !== "")
    : [];

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
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="font-display text-3xl font-semibold">
          {isAdmin ? t("admin_home_title") : t("nav_dashboard")}
        </h1>
        <div className="gold-rule mt-3 w-24" />

        {isAdmin ? (
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
          <div className="mt-8 space-y-6">
            <div className="card-elevated space-y-4 p-6">
              <div className="flex items-start gap-3">
                {!submitted ? (
                  <FileEdit className="mt-0.5 size-6 text-warning" />
                ) : status === "approved" ? (
                  <CheckCircle2 className="mt-0.5 size-6 text-success" />
                ) : status === "rejected" ? (
                  <XCircle className="mt-0.5 size-6 text-destructive" />
                ) : (
                  <Clock className="mt-0.5 size-6 text-warning" />
                )}
                <div>
                  <h2 className="font-display text-xl font-semibold">
                    {!submitted
                      ? t("draft_saved")
                      : status === "approved"
                        ? t("status_approved")
                        : status === "rejected"
                          ? t("status_rejected")
                          : t("status_pending")}
                  </h2>
                  {!submitted && (
                    <p className="mt-1 text-sm text-muted-foreground">{t("draft_saved_d")}</p>
                  )}
                  {submitted && status === "pending" && (
                    <p className="mt-1 text-sm text-muted-foreground">{t("status_pending_d")}</p>
                  )}
                  {profile?.admin_notes && (
                    <p className="mt-2 rounded-md bg-secondary/60 p-3 text-sm">
                      {profile.admin_notes}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm">
                <span className="text-muted-foreground">{t("plans_title")}:</span>
                <span className="font-medium capitalize">{profile?.membership_plan}</span>
                {profile?.plan_valid_until && (
                  <span className="text-muted-foreground">
                    ({String(profile.plan_valid_until)})
                  </span>
                )}
              </div>
              <Button asChild variant={submitted ? "secondary" : "default"}>
                <a href={registerHref}>{submitted ? t("edit_profile") : t("continue_reg")}</a>
              </Button>
            </div>

            <div className="card-elevated p-6">
              <h2 className="font-display text-xl font-semibold">{t("my_profile")}</h2>
              <div className="gold-rule mt-3 w-16" />
              {photoUrl && (
                <img
                  src={photoUrl}
                  alt={t("photo")}
                  onError={() => setPhotoUrl(null)}
                  className="mt-4 size-36 rounded-lg border border-border object-cover"
                />
              )}
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                {rows.map((r) => (
                  <div key={r.label}>
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="font-medium">{String(r.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="card-elevated p-6">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display text-lg font-semibold">{t("upl_gallery_title")}</h2>
                <span className="text-xs text-muted-foreground">
                  {photos.length} / {MAX_PHOTOS_PER_PROFILE}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t("upl_gallery_sub")}</p>
              <div className="gold-rule mt-3 w-16" />

              {docsLoading ? (
                <p className="mt-4 text-sm text-muted-foreground">…</p>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {photos.map((photo) => (
                    <div
                      key={photo.id}
                      className="relative aspect-[3/4] overflow-hidden rounded-lg border border-border"
                    >
                      {viewUrls[photo.storage_key] ? (
                        <img
                          src={viewUrls[photo.storage_key]}
                          alt={photo.file_name ?? t("photo")}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center bg-secondary/40 text-muted-foreground">
                          <Images className="size-6" />
                        </div>
                      )}
                      {profile?.photo_url === photo.storage_key && (
                        <span className="absolute left-1.5 top-1.5 rounded-full bg-success px-2 py-0.5 text-[10px] font-medium text-white">
                          {t("upl_primary")}
                        </span>
                      )}
                      <span className="absolute bottom-1.5 left-1.5 flex gap-1">
                        <button
                          type="button"
                          title={t("adm_view")}
                          className="rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
                          onClick={() => openFile(photo.storage_key)}
                        >
                          <ExternalLink className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          title={t("delete")}
                          className="rounded-full bg-destructive/80 p-1.5 text-white hover:bg-destructive"
                          disabled={removing}
                          onClick={() => removeFile(photo)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    </div>
                  ))}
                  {photos.length < MAX_PHOTOS_PER_PROFILE && (
                    <button
                      type="button"
                      className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-secondary/40"
                      onClick={() => photoInputRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? (
                        <span className="text-xs">{t("uploading_label")}</span>
                      ) : (
                        <>
                          <Plus className="size-6" />
                          <Upload className="size-4" />
                          <span>{t("upl_add_photo")}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
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
              <p className="mt-3 text-xs text-muted-foreground">{t("upl_storage_hint")}</p>
            </div>

            <div className="card-elevated p-6">
              <h2 className="font-display text-lg font-semibold">{t("upl_docs_title")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("upl_docs_hint")}</p>
              <div className="gold-rule mt-3 w-16" />

              {docsLoading ? (
                <p className="mt-4 text-sm text-muted-foreground">…</p>
              ) : docRows.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">{t("upl_no_docs")}</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {docRows.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
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
                        disabled={removing}
                        onClick={() => removeFile(doc)}
                      >
                        <Trash2 className="mr-1 size-3.5" />
                        {t("delete")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                {t("upl_storage_used_pre")}: {formatBytes(usedBytes)} /{" "}
                {formatBytes(MAX_PROFILE_STORAGE_BYTES)}
              </p>
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
