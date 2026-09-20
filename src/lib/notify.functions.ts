import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const ADMIN_EMAIL = "vijayalakshmi@srilakshmimangalyamalai.com";

async function clientProfileIdFor(profileId: string): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("client_profile_id")
      .eq("id", profileId)
      .maybeSingle();
    return data?.client_profile_id ?? null;
  } catch {
    return null;
  }
}

type Alert = {
  kind: string;
  subject: string;
  body: string;
  email_to: string;
  related_user_id: string | null;
  /** Deterministic per logical event; used for email + row dedupe. */
  dedupeKey?: string;
};

/**
 * Records an alert and emails it. Rows are always stored so the admin never
 * loses an event, even if delivery fails.
 *
 * When `dedupe` is enabled the exact same logical event (same kind, recipient,
 * profile and body) is only recorded/sent once, and the email idempotency key
 * becomes deterministic so retried sends of the same event are suppressed by
 * the email provider instead of creating duplicates.
 */
async function deliver(alerts: Alert[], opts?: { dedupe?: boolean }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");

  for (const alert of alerts) {
    if (opts?.dedupe) {
      let query = supabaseAdmin
        .from("notifications")
        .select("id")
        .eq("kind", alert.kind)
        .eq("email_to", alert.email_to)
        .eq("body", alert.body);
      query = alert.related_user_id ? query.eq("related_user_id", alert.related_user_id) : query;
      const { data: existing } = await query.maybeSingle();
      if (existing) continue;
    }
    let emailed = false;
    let email_error: string | null = null;
    try {
      const result = await sendTemplateEmail("notice", alert.email_to, {
        templateData: { title: alert.subject, body: alert.body },
        idempotencyKey:
          alert.dedupeKey ?? `${alert.kind}-${alert.related_user_id ?? "none"}-${Date.now()}`,
      });
      emailed = result.sent;
      if (!result.sent) email_error = result.reason;
    } catch (err) {
      email_error = err instanceof Error ? err.message : "send failed";
    }
    const { dedupeKey: _dedupeKey, ...notification } = alert;
    await supabaseAdmin.from("notifications").insert({ ...notification, emailed, email_error });
  }
}

export const notifyProfileSubmitted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ fullName: z.string().max(200), memberEmail: z.string().email() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const cpid = await clientProfileIdFor(context.userId);
    await deliver([
      {
        kind: "profile_submitted",
        subject: `New profile submitted — ${data.fullName}`,
        body: `${data.fullName} (${data.memberEmail}) submitted a profile for approval. Open the admin approval queue to review the ID, photo and AI pre-check.${cpid ? `\nClient Profile ID: ${cpid}` : ""}`,
        email_to: ADMIN_EMAIL,
        related_user_id: context.userId,
      },
      {
        kind: "profile_submitted_member",
        subject: "We received your profile",
        body: `Thank you ${data.fullName}. Your profile and documents are with our team for verification. You will hear from us once a decision is made.`,
        email_to: data.memberEmail,
        related_user_id: context.userId,
      },
    ]);
    return { ok: true };
  });

export const notifyApprovalChanged = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        memberId: z.string().uuid(),
        memberEmail: z.string().email().nullable(),
        fullName: z.string().max(200),
        status: z.enum(["approved", "rejected"]),
        note: z.string().max(2000).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const cpid = await clientProfileIdFor(data.memberId);

    const alerts: Alert[] = [
      {
        kind: "approval_changed",
        subject: `Profile ${data.status} — ${data.fullName}`,
        body: `${data.fullName} was marked ${data.status}.${data.note ? ` Note: ${data.note}` : ""}${cpid ? `\nClient Profile ID: ${cpid}` : ""}`,
        email_to: ADMIN_EMAIL,
        related_user_id: data.memberId,
      },
    ];
    if (data.memberEmail) {
      alerts.push({
        kind: "approval_changed_member",
        subject:
          data.status === "approved"
            ? "Your profile has been approved"
            : "About your profile application",
        body:
          data.status === "approved"
            ? `Good news ${data.fullName} — your profile is approved. You can now sign in and browse matches.`
            : `Dear ${data.fullName}, your profile could not be approved at this time.${data.note ? ` Reason: ${data.note}` : ""} You may correct the details and submit again.`,
        email_to: data.memberEmail,
        related_user_id: data.memberId,
      });
    }
    await deliver(alerts);
    return { ok: true };
  });

/**
 * Notifies the client (and, when the profile just entered the approval queue,
 * the admins) that an administrator created or updated a profile on the
 * client's behalf. Uses deterministic dedupe keys so retries of the same
 * operation do not produce duplicate notifications or duplicate emails.
 */
export async function notifyAdminProfileAction(input: {
  profileId: string;
  memberEmail: string;
  fullName: string;
  action: "created" | "updated";
  awaitingReview: boolean;
  at: string;
}): Promise<void> {
  const cpid = await clientProfileIdFor(input.profileId);
  const alerts: Alert[] = [];
  const clientBody =
    input.action === "created"
      ? `Dear ${input.fullName}, a profile has been created for you on Sri Lakshmi Mangalya Malai on behalf of the team and submitted through our standard approval process. Our team will review it and notify you once a decision is made.`
      : input.awaitingReview
        ? `Dear ${input.fullName}, your profile was updated by an administrator on your behalf and submitted through our standard approval process. Our team will review it and notify you once a decision is made.`
        : `Dear ${input.fullName}, your profile was updated by an administrator on your behalf (${new Date(input.at).toISOString()}). If you have any questions, please contact us.`;

  alerts.push({
    kind:
      input.action === "created"
        ? "client_profile_created_by_admin"
        : "client_profile_updated_by_admin",
    subject:
      input.action === "created"
        ? "Your profile is ready for review — Sri Lakshmi Mangalya Malai"
        : input.awaitingReview
          ? "Your profile was updated and submitted for review"
          : "Your profile was updated",
    body: clientBody,
    email_to: input.memberEmail,
    related_user_id: input.profileId,
    dedupeKey: `${input.action === "created" ? "client-profile-created" : "client-profile-updated"}-${input.profileId}-${input.action === "created" ? "once" : input.at}`,
  });

  if (input.awaitingReview) {
    alerts.push({
      kind: "admin_profile_awaiting_review",
      subject: `Admin-created profile awaiting review — ${input.fullName}`,
      body: `${input.fullName} submitted an admin-created profile for approval. Review it in the Approval queue.${cpid ? `\nClient Profile ID: ${cpid}` : ""}`,
      email_to: ADMIN_EMAIL,
      related_user_id: input.profileId,
      dedupeKey: `admin-profile-awaiting-${input.profileId}`,
    });
  }

  await deliver(alerts, { dedupe: true });
}

/** Client-side path: admin edits a client profile via the review dialog. */
export const notifyProfileUpdatedByAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        profileId: z.string().uuid(),
        memberEmail: z.string().email().nullable(),
        fullName: z.string().max(200),
        updatedAt: z.string(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    if (!data.memberEmail) return { ok: true };

    await notifyAdminProfileAction({
      profileId: data.profileId,
      memberEmail: data.memberEmail,
      fullName: data.fullName,
      action: "updated",
      awaitingReview: false,
      at: data.updatedAt,
    });
    return { ok: true };
  });

export const notifyPaymentSubmitted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        item: z.enum(["standard", "premium", "jathagam"]),
        amount: z.number().int(),
        reference: z.string().max(120),
        fullName: z.string().max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await deliver([
      {
        kind: "payment_submitted",
        subject: `Payment submitted — ${data.fullName} (₹${data.amount})`,
        body: `${data.fullName} submitted a ${data.item} payment of ₹${data.amount}. Reference: ${data.reference}. Verify it in the admin payments section.`,
        email_to: ADMIN_EMAIL,
        related_user_id: context.userId,
      },
    ]);
    return { ok: true };
  });

export const notifyJathagamReady = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        memberId: z.string().uuid(),
        memberEmail: z.string().email(),
        fullName: z.string().max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    await deliver([
      {
        kind: "jathagam_ready_member",
        subject: "Your Jathagam report is ready",
        body: `Dear ${data.fullName}, your horoscope (Jathagam) report has been prepared and is now available in your account. Sign in and open the Payments page to download your report.`,
        email_to: data.memberEmail,
        related_user_id: data.memberId,
      },
      {
        kind: "jathagam_ready",
        subject: `Jathagam report sent — ${data.fullName}`,
        body: `The horoscope report for ${data.fullName} (${data.memberEmail}) was activated and emailed.`,
        email_to: ADMIN_EMAIL,
        related_user_id: data.memberId,
      },
    ]);
    return { ok: true };
  });
