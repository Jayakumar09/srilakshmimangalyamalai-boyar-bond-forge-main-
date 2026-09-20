import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { notifyAdminProfileAction } from "@/lib/notify.functions";

const fieldSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  phone: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  marital_status: z.string().optional().nullable(),
  sub_caste: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  native_district: z.string().optional().nullable(),
  education_level: z.string().optional().nullable(),
  profession: z.string().optional().nullable(),
  family_details: z.string().optional().nullable(),
  pref_notes: z.string().optional().nullable(),
  about: z.string().optional().nullable(),
  redirectUrl: z.string().url().optional().nullish(),
});

/** Best-effort app origin so password-set links point at the site the admin used. */
function requestOrigin(): string | undefined {
  try {
    const req = getRequest();
    const host = req?.headers?.get("host");
    if (!host) return undefined;
    const proto = req?.headers?.get("x-forwarded-proto") === "https" ? "https" : "http";
    return `${proto}://${host}`;
  } catch {
    return undefined;
  }
}

/**
 * Generates a Supabase password-recovery link for the client and emails it.
 * Uses the existing Supabase Auth recovery mechanism (never a plaintext password).
 * Records the outcome in notifications so admins can follow up manually if email fails.
 */
async function deliverClientInvite(input: {
  profileId: string;
  email: string;
  fullName: string;
  redirectUrl?: string | null;
}): Promise<"sent" | "failed" | "unavailable"> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const base = input.redirectUrl || requestOrigin() || "https://srilakshmimangalyamalai.com";
  try {
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: input.email,
      options: { redirectTo: `${base}/reset-password` },
    });
    const actionLink = linkData?.properties?.action_link;
    if (linkError || !actionLink) {
      throw new Error(linkError?.message ?? "Could not generate a recovery link");
    }

    let emailed = false;
    let emailError: string | null = null;
    try {
      const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
      const result = await sendTemplateEmail("notice", input.email, {
        templateData: {
          title: "Your matrimony account is ready",
          body: `Dear ${input.fullName}, an account has been created for you on Sri Lakshmi Mangalya Malai. Use the link below to choose your password, then sign in and complete your profile.`,
          ctaLabel: "Set your password",
          ctaUrl: actionLink,
        },
        idempotencyKey: `client-invite-${input.profileId}-${Date.now()}`,
      });
      emailed = result.sent;
      if (!result.sent) emailError = result.reason;
    } catch (err) {
      emailError = err instanceof Error ? err.message : "email send failed";
    }

    await supabaseAdmin.from("notifications").insert({
      kind: "client_invite",
      subject: `Account access invitation — ${input.fullName}`,
      body: emailed
        ? "A password-set link was emailed to the client."
        : `A password-set link was generated but could not be emailed to the client. Share it manually: ${actionLink}`,
      email_to: input.email,
      related_user_id: input.profileId,
      emailed,
      email_error: emailError,
    });

    return emailed ? "sent" : "failed";
  } catch (err) {
    const message = err instanceof Error ? err.message : "invite failed";
    await supabaseAdmin.from("notifications").insert({
      kind: "client_invite",
      subject: `Account access invitation — ${input.fullName}`,
      body: "A password-set link could not be generated. Check the Supabase service-role configuration.",
      email_to: input.email,
      related_user_id: input.profileId,
      emailed: false,
      email_error: message,
    });
    return "unavailable";
  }
}

/**
 * Admin creates a matrimonial profile on behalf of a client.
 * The profile always belongs to the client: the admin is only recorded as the operator.
 * If the client already has an account/profile, that profile is updated instead of duplicated.
 * A password-recovery link is emailed to the client so they can set their own password.
 */
export const createClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => fieldSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Admins only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.trim().toLowerCase();

    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id, status, submitted_at, profile_created_by")
      .eq("email", email)
      .maybeSingle();

    let userId = existing?.id ?? null;
    let existed = Boolean(existing);

    if (!userId) {
      const created = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: `Slmm-${crypto.randomUUID()}`,
        user_metadata: { full_name: data.full_name },
      });
      if (created.error || !created.data.user) {
        throw new Error(created.error?.message ?? "Could not create the client account");
      }
      userId = created.data.user.id;
      existed = false;
    }

    const { email: _ignored, redirectUrl: _redirectUrl, ...fields } = data;
    const patch: Record<string, unknown> = {
      ...fields,
      email,
      last_updated_by: context.userId,
      last_updated_by_type: "admin",
      last_updated_at: new Date().toISOString(),
    };
    const nowIso = new Date().toISOString();
    if (!existed) {
      patch["profile_created_by"] = "admin";
      patch["created_by_admin_id"] = context.userId;
      patch["status"] = "pending";
      patch["submitted_at"] = nowIso;
    } else if (existing && !existing.submitted_at) {
      // Existing profile that never entered the approval queue: submit it now so it
      // follows the same workflow as a client submission. approved/rejected/already
      // submitted profiles are intentionally left untouched.
      patch["status"] = "pending";
      patch["submitted_at"] = nowIso;
    }

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, ...patch }, { onConflict: "id" });
    if (updateError) throw new Error(updateError.message);

    await supabaseAdmin.from("profile_audit").insert({
      profile_id: userId,
      actor_id: context.userId,
      actor_type: "admin",
      action: existed ? "admin_updated" : "admin_created",
      details: existed
        ? "Admin updated existing client profile on behalf of client."
        : "Admin created profile on behalf of client.",
    });

    const enteredQueue = !existed || !existing?.submitted_at;
    try {
      await notifyAdminProfileAction({
        profileId: userId,
        memberEmail: email,
        fullName: data.full_name,
        action: existed ? "updated" : "created",
        awaitingReview: enteredQueue,
        at: nowIso,
      });
    } catch {
      /* notification failures must never block the profile operation */
    }

    const invitation = await deliverClientInvite({
      profileId: userId,
      email,
      fullName: data.full_name,
      redirectUrl: (data.redirectUrl as string | null | undefined) ?? null,
    });

    return { id: userId, existed, invitation };
  });
