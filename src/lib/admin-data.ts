import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createViewUrl } from "@/lib/storage.functions";
import { uploadToR2 } from "@/lib/upload";
import { reviewPayment } from "@/lib/payments.functions";
import { notifyApprovalChanged, notifyProfileUpdatedByAdmin } from "@/lib/notify.functions";

export type AdminProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  gender: string | null;
  date_of_birth: string | null;
  marital_status: string | null;
  caste?: string | null;
  sub_caste: string | null;
  phone: string | null;
  whatsapp?: string | null;
  city: string | null;
  native_district: string | null;
  state?: string | null;
  address_line?: string | null;
  pincode?: string | null;
  education_level: string | null;
  education_detail?: string | null;
  profession: string | null;
  job_detail?: string | null;
  annual_income?: string | null;
  gothram?: string | null;
  mother_tongue?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  father_name?: string | null;
  father_occupation?: string | null;
  mother_name?: string | null;
  mother_occupation?: string | null;
  siblings?: string | null;
  brothers?: number | null;
  sisters?: number | null;
  family_type?: string | null;
  family_status?: string | null;
  family_details?: string | null;
  pref_notes?: string | null;
  pref_age_min?: number | null;
  pref_age_max?: number | null;
  pref_height_min_cm?: number | null;
  pref_marital_status?: string | null;
  pref_sub_caste?: string | null;
  pref_education?: string | null;
  pref_profession?: string | null;
  pref_district?: string | null;
  about?: string | null;
  birth_time?: string | null;
  birth_place?: string | null;
  admin_notes?: string | null;
  client_profile_id?: string | null;
  photo_url: string | null;
  membership_plan: "free" | "standard" | "premium";
  status: "pending" | "approved" | "rejected";
  submitted_at: string | null;
  created_at: string | null;
  profile_created_by?: string | null;
  created_by_admin_id?: string | null;
  last_updated_by?: string | null;
  last_updated_by_type?: string | null;
  last_updated_at?: string | null;
};

export type ProfileAudit = {
  id: string;
  profile_id: string;
  actor_type: string;
  action: string;
  details: string | null;
  created_at: string;
};

/**
 * The client's confirmation/request on record for a profile, drawn from the
 * existing support-thread messaging. `hasClientConfirmation` is true only when
 * the client (sender_type "member") has sent a message — email is never proof.
 */
export type ClientRequest = {
  threadId: string | null;
  subject: string | null;
  status: string | null;
  hasClientConfirmation: boolean;
  latestClientBody: string | null;
  latestClientAt: string | null;
  lastMessageAt: string | null;
};

export type AdminDoc = {
  id: string;
  user_id: string;
  doc_type: string;
  id_kind: string | null;
  storage_key: string;
  size_bytes: number | null;
  ai_check_status: string | null;
  ai_check_notes: string | null;
  ai_face_match_score: number | null;
};

export type AdminPayment = {
  id: string;
  user_id: string;
  item: string;
  amount_inr: number;
  method: string;
  utr_reference: string | null;
  proof_key: string | null;
  status: "submitted" | "verified" | "rejected";
  created_at: string;
};

export type AdminJathagam = {
  id: string;
  user_id: string;
  birth_date: string;
  birth_time: string;
  birth_place: string;
  status: string;
  report_key: string | null;
  created_at: string | null;
};

export type AdminReport = {
  id: string;
  reporter_id: string;
  target_id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
};

export type AdminBlock = {
  id: string;
  user_id: string;
  target_id: string;
  created_at: string;
};

export type AdminAlert = {
  id: string;
  kind: string;
  subject: string;
  body: string;
  email_to: string;
  emailed: boolean;
  created_at: string;
};

export const R2_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB free tier
export const DB_QUOTA_BYTES = 500 * 1024 * 1024; // 500 MB

export type AdminData = ReturnType<typeof useAdminData>;

/** Loads every dataset the admin workspace renders. Admin-only, guarded by RLS + a role check. */
export function useAdminData() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [docs, setDocs] = useState<AdminDoc[]>([]);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [jathagam, setJathagam] = useState<AdminJathagam[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [blocks, setBlocks] = useState<AdminBlock[]>([]);
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);

  const reload = useCallback(async () => {
    const [
      { data: profileRows },
      { data: documents },
      { data: pays },
      { data: jats },
      { data: reps },
      { data: blockRows },
      { data: alertRows },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("documents").select("*"),
      supabase
        .from("payments")
        .select(
          "id, user_id, item, amount_inr, method, utr_reference, proof_key, status, created_at",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("jathagam_requests")
        .select("id, user_id, birth_date, birth_time, birth_place, status, report_key, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("reports")
        .select("id, reporter_id, target_id, reason, details, status, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("blocks")
        .select("id, user_id, target_id, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("notifications")
        .select("id, kind, subject, body, email_to, emailed, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setProfiles((profileRows ?? []) as AdminProfile[]);
    setDocs((documents ?? []) as AdminDoc[]);
    setPayments((pays ?? []) as AdminPayment[]);
    setJathagam((jats ?? []) as AdminJathagam[]);
    setReports((reps ?? []) as AdminReport[]);
    setBlocks((blockRows ?? []) as AdminBlock[]);
    setAlerts((alertRows ?? []) as AdminAlert[]);
    setLoading(false);
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
      await reload();
    });
  }, [reload, navigate]);

  const decideProfile = useCallback(
    async (id: string, status: "approved" | "rejected", note: string | null) => {
      const member = profiles.find((r) => r.id === id);
      const { error } = await supabase
        .from("profiles")
        .update({ status, admin_notes: note })
        .eq("id", id);
      if (error) {
        toast.error(error.message);
        return;
      }
      try {
        await notifyApprovalChanged({
          data: {
            memberId: id,
            memberEmail: member?.email ?? null,
            fullName: member?.full_name ?? "Member",
            status,
            note,
          },
        });
      } catch {
        /* alert logging must never block the decision */
      }
      toast.success(status === "approved" ? "Profile approved" : "Profile rejected");
      await reload();
    },
    [profiles, reload],
  );

  const decidePayment = useCallback(
    async (paymentId: string, decision: "verified" | "rejected", note: string | null) => {
      setBusy(true);
      try {
        await reviewPayment({ data: { paymentId, decision, note } });
        toast.success(decision === "verified" ? "Payment verified" : "Payment rejected");
        await reload();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not update payment");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const uploadHoroscope = useCallback(
    async (requestId: string, file: File) => {
      setBusy(true);
      try {
        const up = await uploadToR2(file, "jathagam");
        const { error } = await supabase
          .from("jathagam_requests")
          .update({ report_key: up.key, report_file_name: up.fileName, status: "ready" })
          .eq("id", requestId);
        if (error) throw new Error(error.message);
        toast.success("Horoscope report uploaded");
        await reload();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const closeReport = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("reports").update({ status: "closed" }).eq("id", id);
      if (error) toast.error(error.message);
      else await reload();
    },
    [reload],
  );

  const openDoc = useCallback(async (key: string) => {
    try {
      const { url } = await createViewUrl({ data: { key } });
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open file");
    }
  }, []);


  /** Admin edits a client's profile. `mode` records whether this was a direct
   *  admin edit (Admin Created profiles) or done on behalf of the client after
   *  a client confirmation/request (Client Created profiles). Ownership never
   *  changes — `profile_created_by` is preserved. */
  const adminUpdateProfile = useCallback(
    async (
      profileId: string,
      patch: Record<string, unknown>,
      note: string,
      mode: "direct" | "on_behalf" = "direct",
      threadId: string | null = null,
    ) => {
      setBusy(true);
      try {
        const { data: me } = await supabase.auth.getUser();
        const updatedAt = new Date().toISOString();
        const { error } = await supabase
          .from("profiles")
          .update({
            ...patch,
            last_updated_by: me.user?.id ?? null,
            last_updated_by_type: "admin",
            last_updated_at: updatedAt,
          })
          .eq("id", profileId);
        if (error) throw new Error(error.message);
        const action =
          mode === "on_behalf" ? "admin_updated_on_behalf" : "admin_updated";
        const details =
          mode === "on_behalf" && threadId
            ? `${note} (Client confirmation/request in support thread ${threadId}.)`
            : note;
        await supabase.from("profile_audit").insert({
          profile_id: profileId,
          actor_id: me.user?.id ?? null,
          actor_type: "admin",
          action,
          details,
        });
        try {
          const member = profiles.find((p) => p.id === profileId);
          await notifyProfileUpdatedByAdmin({
            data: {
              profileId,
              memberEmail: member?.email ?? null,
              fullName: member?.full_name ?? "Member",
              updatedAt,
            },
          });
        } catch {
          /* notification failures must never block the save */
        }
        await reload();
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [profiles, reload],
  );

  /** Sends the member a support message asking them to correct their profile. */
  const requestCorrection = useCallback(async (profileId: string, message: string) => {
    const { data: me } = await supabase.auth.getUser();
    const { data: existing } = await supabase
      .from("support_threads")
      .select("id")
      .eq("user_id", profileId)
      .eq("status", "open")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let threadId = existing?.id ?? null;
    if (!threadId) {
      const { data: created, error } = await supabase
        .from("support_threads")
        .insert({ user_id: profileId, subject: "Profile correction requested" })
        .select("id")
        .single();
      if (error) {
        toast.error(error.message);
        return false;
      }
      threadId = created.id;
    }
    const { error: msgError } = await supabase.from("support_messages").insert({
      thread_id: threadId,
      sender_id: me.user?.id ?? profileId,
      sender_type: "admin",
      body: message,
    });
    if (msgError) {
      toast.error(msgError.message);
      return false;
    }
    await supabase
      .from("support_threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", threadId);
    return true;
  }, []);

  const loadAudit = useCallback(async (profileId: string) => {
    const { data } = await supabase
      .from("profile_audit")
      .select("id, profile_id, actor_type, action, details, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false });
    return (data ?? []) as ProfileAudit[];
  }, []);

  /** Loads the record of client confirmation/request from the existing support
   *  thread messaging. Only a message sent by the client counts as confirmation. */
  const loadClientRequest = useCallback(async (profileId: string): Promise<ClientRequest | null> => {
    const { data: thread } = await supabase
      .from("support_threads")
      .select("id, subject, status, last_message_at")
      .eq("user_id", profileId)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const messages = thread
      ? await supabase
          .from("support_messages")
          .select("id, sender_type, body, created_at")
          .eq("thread_id", thread.id)
          .order("created_at", { ascending: true })
      : null;
    const clientMessages = (messages?.data ?? []).filter((m) => m.sender_type === "member");
    const latest = clientMessages.length > 0 ? clientMessages[clientMessages.length - 1] : null;
    return {
      threadId: thread?.id ?? null,
      subject: thread?.subject ?? null,
      status: thread?.status ?? null,
      hasClientConfirmation: clientMessages.length > 0,
      latestClientBody: latest?.body ?? null,
      latestClientAt: latest?.created_at ?? null,
      lastMessageAt: thread?.last_message_at ?? null,
    };
  }, []);

  const storageUsed = docs.reduce((sum, d) => sum + (d.size_bytes ?? 0), 0);
  const dbApprox = profiles.length * 6 * 1024 + docs.length * 1024;

  return {
    allowed,
    loading,
    busy,
    profiles,
    docs,
    payments,
    jathagam,
    reports,
    blocks,
    alerts,
    storageUsed,
    dbApprox,
    storagePct: Math.min(100, Math.round((storageUsed / R2_QUOTA_BYTES) * 100)),
    dbPct: Math.min(100, Math.round((dbApprox / DB_QUOTA_BYTES) * 100)),
    reload,
    decideProfile,
    decidePayment,
    uploadHoroscope,
    closeReport,
    openDoc,
    adminUpdateProfile,
    requestCorrection,
    loadAudit,
    loadClientRequest,
  };
}

export function memberName(profiles: AdminProfile[], id: string) {
  return profiles.find((p) => p.id === id)?.full_name ?? id.slice(0, 8);
}

export function ageFrom(dob: string | null) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
}
