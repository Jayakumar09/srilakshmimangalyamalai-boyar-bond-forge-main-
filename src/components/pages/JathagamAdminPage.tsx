import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { uploadToR2 } from "@/lib/upload";
import { createViewUrl } from "@/lib/storage.functions";
import { notifyJathagamReady } from "@/lib/notify.functions";

type Request = {
  id: string;
  user_id: string;
  birth_date: string;
  birth_time: string;
  birth_place: string;
  status: string;
  report_key: string | null;
  report_file_name: string | null;
};

type Member = { id: string; full_name: string | null; email: string | null };

export function JathagamAdminPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Request[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: reqs }, { data: profs }] = await Promise.all([
      supabase
        .from("jathagam_requests")
        .select("id, user_id, birth_date, birth_time, birth_place, status, report_key, report_file_name")
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name, email"),
    ]);
    setRows((reqs ?? []) as Request[]);
    setMembers((profs ?? []) as Member[]);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: role } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!role) {
        setAllowed(false);
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      setAllowed(true);
      await load();
    });
  }, [load, navigate]);

  async function upload(row: Request, file: File) {
    setBusy(row.id);
    try {
      const up = await uploadToR2(file, "jathagam");
      const { error } = await supabase
        .from("jathagam_requests")
        .update({ report_key: up.key, report_file_name: up.fileName, status: "uploaded" })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      toast.success(t("jat_uploaded_ok"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("jat_failed"));
    } finally {
      setBusy(null);
    }
  }

  async function activate(row: Request) {
    if (!row.report_key) {
      toast.error(t("jat_upload_first"));
      return;
    }
    setBusy(row.id);
    try {
      const { error } = await supabase
        .from("jathagam_requests")
        .update({ status: "ready" })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      toast.success(t("jat_activated_ok"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("jat_failed"));
    } finally {
      setBusy(null);
    }
  }

  async function emailMember(row: Request) {
    const member = members.find((m) => m.id === row.user_id);
    if (!row.report_key) {
      toast.error(t("jat_upload_first"));
      return;
    }
    if (!member?.email) {
      toast.error(t("jat_no_email"));
      return;
    }
    setBusy(row.id);
    try {
      await notifyJathagamReady({
        data: {
          memberId: row.user_id,
          memberEmail: member.email,
          fullName: member.full_name ?? "Member",
        },
      });
      toast.success(t("jat_emailed_ok"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("jat_failed"));
    } finally {
      setBusy(null);
    }
  }

  async function openReport(key: string) {
    try {
      const { url } = await createViewUrl({ data: { key } });
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("jat_failed"));
    }
  }

  if (!allowed) return null;

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="font-display text-3xl font-semibold">{t("jat_page_title")}</h1>
        <div className="gold-rule mt-3 w-24" />
        <p className="mt-3 text-sm text-muted-foreground">{t("jat_page_sub")}</p>

        {rows.length === 0 && (
          <p className="mt-8 text-sm text-muted-foreground">{t("jat_no_requests")}</p>
        )}

        <div className="mt-6 space-y-4">
          {rows.map((row) => {
            const member = members.find((m) => m.id === row.user_id);
            const statusLabel =
              row.status === "ready"
                ? t("jat_status_ready")
                : row.report_key
                  ? t("jat_status_uploaded")
                  : t("jat_status_pending");
            return (
              <div key={row.id} className="card-elevated p-5 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-semibold">
                      {member?.full_name ?? row.user_id.slice(0, 8)}
                    </p>
                    <p className="text-muted-foreground">{member?.email ?? "—"}</p>
                    <p className="mt-1 text-muted-foreground">
                      {t("jat_birth")}: {row.birth_date} · {row.birth_time} · {row.birth_place}
                    </p>
                  </div>
                  <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
                    {statusLabel}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <label className="text-xs">
                    <span className="mr-2">{t("upload_report")}</span>
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      disabled={busy === row.id}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void upload(row, f);
                      }}
                    />
                  </label>
                  {row.report_key && (
                    <Button size="sm" variant="secondary" onClick={() => openReport(row.report_key!)}>
                      {t("download_report")}
                    </Button>
                  )}
                  {row.status !== "ready" && (
                    <Button size="sm" disabled={busy === row.id} onClick={() => activate(row)}>
                      {t("jat_activate")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === row.id}
                    onClick={() => emailMember(row)}
                  >
                    {t("jat_email")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
