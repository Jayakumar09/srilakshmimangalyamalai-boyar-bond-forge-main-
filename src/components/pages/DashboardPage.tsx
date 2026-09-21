import { useEffect, useState } from "react";
import { Clock, CheckCircle2, XCircle, FileEdit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { createViewUrl } from "@/lib/storage.functions";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
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

export function DashboardPage() {
  const { t, lang } = useI18n();
  const { isAdmin, roleReady } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const registerHref = lang === "ta" ? "/ta/register" : "/register";

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: row } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .maybeSingle();
      setProfile(row as Profile | null);
      setLoading(false);
      const key = (row as Profile | null)?.photo_url;
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

  const v = (k: string) => (profile ? profile[k] : null);

  const rows: { label: string; value: unknown }[] = profile
    ? [
        { label: t("adm_profile_id"), value: v("client_profile_id") },
        { label: t("full_name"), value: v("full_name") },
        { label: t("gender"), value: v("gender") },
        { label: t("dob"), value: v("date_of_birth") },
        { label: t("marital_status"), value: v("marital_status") },
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
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
