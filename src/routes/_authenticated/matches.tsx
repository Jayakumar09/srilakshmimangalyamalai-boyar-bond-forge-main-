import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Heart, Ban, Flag, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/matches")({
  head: () => ({
    meta: [
      { title: "Find matches — Sri Lakshmi Mangalya Malai" },
      {
        name: "description",
        content:
          "Search admin-approved Boyar community profiles by age, sub-caste, district, education and profession.",
      },
      { property: "og:title", content: "Find matches — Sri Lakshmi Mangalya Malai" },
      { property: "og:description", content: "Search approved community profiles." },
    ],
  }),
  component: Matches,
});

type Row = {
  id: string;
  full_name: string | null;
  gender: string | null;
  date_of_birth: string | null;
  marital_status: string | null;
  sub_caste: string | null;
  native_district: string | null;
  city: string | null;
  education_level: string | null;
  education_detail: string | null;
  profession: string | null;
  height_cm: number | null;
  about: string | null;
};

function age(dob: string | null) {
  if (!dob) return null;
  const d = new Date(dob);
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

function Matches() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [me, setMe] = useState<{ id: string; gender: string | null; status: string; plan: string } | null>(
    null,
  );
  const [rows, setRows] = useState<Row[]>([]);
  const [shortlisted, setShortlisted] = useState<Set<string>>(new Set());
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    ageMin: "",
    ageMax: "",
    subCaste: "",
    district: "",
    education: "",
    profession: "",
  });

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, gender, status, membership_plan")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (!profile) {
      setLoading(false);
      return;
    }
    setMe({
      id: profile.id,
      gender: profile.gender,
      status: profile.status,
      plan: profile.membership_plan,
    });

    const [{ data: list }, { data: sl }, { data: bl }] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, full_name, gender, date_of_birth, marital_status, sub_caste, native_district, city, education_level, education_detail, profession, height_cm, about",
        )
        .eq("status", "approved")
        .neq("id", profile.id)
        .limit(200),
      supabase.from("shortlists").select("target_id"),
      supabase.from("blocks").select("target_id"),
    ]);
    setRows((list ?? []) as Row[]);
    setShortlisted(new Set((sl ?? []).map((r) => r.target_id)));
    setBlocked(new Set((bl ?? []).map((r) => r.target_id)));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const results = useMemo(() => {
    return rows.filter((r) => {
      if (blocked.has(r.id)) return false;
      if (me?.gender && r.gender && r.gender === me.gender) return false;
      const a = age(r.date_of_birth);
      if (filters.ageMin && (a === null || a < Number(filters.ageMin))) return false;
      if (filters.ageMax && (a === null || a > Number(filters.ageMax))) return false;
      const match = (v: string | null, q: string) =>
        !q || (v ?? "").toLowerCase().includes(q.toLowerCase());
      return (
        match(r.sub_caste, filters.subCaste) &&
        match(r.native_district, filters.district) &&
        match(`${r.education_level ?? ""} ${r.education_detail ?? ""}`, filters.education) &&
        match(r.profession, filters.profession)
      );
    });
  }, [rows, blocked, me, filters]);

  async function toggleShortlist(targetId: string) {
    if (!me) return;
    if (shortlisted.has(targetId)) {
      await supabase.from("shortlists").delete().eq("user_id", me.id).eq("target_id", targetId);
      setShortlisted((s) => {
        const n = new Set(s);
        n.delete(targetId);
        return n;
      });
    } else {
      await supabase.from("shortlists").insert({ user_id: me.id, target_id: targetId });
      setShortlisted((s) => new Set(s).add(targetId));
      toast.success(t("shortlisted"));
    }
  }

  async function blockUser(targetId: string) {
    if (!me) return;
    await supabase.from("blocks").insert({ user_id: me.id, target_id: targetId });
    setBlocked((b) => new Set(b).add(targetId));
    toast.success("Profile blocked");
  }

  async function reportUser(targetId: string) {
    if (!me) return;
    const reason = window.prompt("Why are you reporting this profile?");
    if (!reason) return;
    const { error } = await supabase
      .from("reports")
      .insert({ reporter_id: me.id, target_id: targetId, reason });
    if (error) toast.error(error.message);
    else toast.success("Reported to the admin");
  }

  async function startChat(targetId: string) {
    if (!me) return;
    if (me.plan === "free") {
      toast.error(t("upgrade_to_message"));
      navigate({ to: "/checkout" });
      return;
    }
    const [user_a, user_b] = [me.id, targetId].sort();
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_a", user_a!)
      .eq("user_b", user_b!)
      .maybeSingle();
    let conversationId = existing?.id;
    if (!conversationId) {
      const { data: created, error } = await supabase
        .from("conversations")
        .insert({ user_a: user_a!, user_b: user_b! })
        .select("id")
        .single();
      if (error) {
        toast.error(error.message);
        return;
      }
      conversationId = created.id;
    }
    navigate({ to: "/messages", search: { c: conversationId } });
  }

  if (!loading && me && me.status !== "approved") {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-16">
          <h1 className="font-display text-3xl font-semibold">{t("matches_title")}</h1>
          <p className="mt-4 text-sm text-muted-foreground">{t("matches_locked")}</p>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="font-display text-3xl font-semibold">{t("matches_title")}</h1>
        <div className="gold-rule mt-3 w-24" />

        <div className="card-elevated mt-6 grid gap-3 p-5 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <Label htmlFor="amin">{t("age_from")}</Label>
            <Input
              id="amin"
              inputMode="numeric"
              value={filters.ageMin}
              onChange={(e) => setFilters((f) => ({ ...f, ageMin: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="amax">{t("age_to")}</Label>
            <Input
              id="amax"
              inputMode="numeric"
              value={filters.ageMax}
              onChange={(e) => setFilters((f) => ({ ...f, ageMax: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="sc">{t("sub_caste")}</Label>
            <Input
              id="sc"
              value={filters.subCaste}
              onChange={(e) => setFilters((f) => ({ ...f, subCaste: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="dt">{t("district")}</Label>
            <Input
              id="dt"
              value={filters.district}
              onChange={(e) => setFilters((f) => ({ ...f, district: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="ed">{t("education_level")}</Label>
            <Input
              id="ed"
              value={filters.education}
              onChange={(e) => setFilters((f) => ({ ...f, education: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="pr">{t("profession")}</Label>
            <Input
              id="pr"
              value={filters.profession}
              onChange={(e) => setFilters((f) => ({ ...f, profession: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-3 lg:col-span-6">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setFilters({
                  ageMin: "",
                  ageMax: "",
                  subCaste: "",
                  district: "",
                  education: "",
                  profession: "",
                })
              }
            >
              {t("clear")}
            </Button>
          </div>
        </div>

        {results.length === 0 && !loading && (
          <p className="mt-8 text-sm text-muted-foreground">{t("no_results")}</p>
        )}

        <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {results.map((r) => (
            <div key={r.id} className="card-elevated p-5">
              <h3 className="font-display text-lg font-semibold">{r.full_name ?? "—"}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {age(r.date_of_birth) ? `${age(r.date_of_birth)} yrs · ` : ""}
                {r.height_cm ? `${r.height_cm} cm · ` : ""}
                {r.marital_status ?? ""}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {[r.sub_caste, r.native_district, r.city].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {[r.education_level, r.education_detail, r.profession].filter(Boolean).join(" · ")}
              </p>
              {r.about && <p className="mt-3 line-clamp-3 text-sm">{r.about}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => startChat(r.id)}>
                  <MessageSquare className="mr-1 size-4" />
                  {t("message")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => toggleShortlist(r.id)}>
                  <Heart
                    className={shortlisted.has(r.id) ? "mr-1 size-4 fill-current" : "mr-1 size-4"}
                  />
                  {shortlisted.has(r.id) ? t("shortlisted") : t("shortlist")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => blockUser(r.id)}>
                  <Ban className="mr-1 size-4" />
                  {t("block")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => reportUser(r.id)}>
                  <Flag className="mr-1 size-4" />
                  {t("report")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
