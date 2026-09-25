import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Downstream, retryable delivery for PAYMENT_VERIFIED events (receipt + client
 * notification). This layer runs AFTER / independently of the atomic
 * verification in verify_payment (B1); it can never reverse a payment
 * verification. The payment_events row is the durable outbox and the
 * processing state.
 *
 * There is no scheduler in this project yet, so `processPendingPaymentDeliveries`
 * is (a) invoked best-effort, non-blocking after a successful verification,
 * and (b) exposed to admins through `retryPaymentDeliveries`. It is a plain
 * function so a cron/scheduler can reuse it later without code changes.
 */

export const MAX_DELIVERY_ATTEMPTS = 5;
// Kept for observability only: claims never transition to a stuck "processing"
// status, so a crashed run is always reclaimable (status stays 'pending').
const LEASE_MINUTES = 5;

type DeliveryRow = {
  payment_id: string;
  user_id: string;
  item: "standard" | "premium" | "jathagam";
  amount_inr: number;
  gateway_order_id: string | null;
  gateway_payment_id: string | null;
  verified_at: string | null;
  receipt_status: string | null;
  receipt_key: string | null;
  receipt_error: string | null;
  receipt_attempts: number | null;
  receipt_lease_until: string | null;
  notification_status: string | null;
  notification_error: string | null;
  notification_attempts: number | null;
  notification_sent_at: string | null;
};

type PaymentSource = { method: string | null; utr_reference: string | null };

type TaxConfig = {
  seller_legal_name: string | null;
  seller_gstin: string | null;
  seller_address: string | null;
  tax_label: string | null;
  tax_rate: number | null;
};

type MemberContact = { full_name: string | null; email: string | null };

// The payment_events / payment_tax_config tables are created by migrations that
// are NOT reflected in the generated Database type, so DB access for those two
// tables is funneled through this narrow thenable-builder shape (matches how
// supabase-js chains resolve).
type QueryResult = { data: any | null; error: { message: string } | null };
type Thenable = PromiseLike<QueryResult>;
type EventsBuilder = Thenable & {
  select(cols: string): EventsBuilder;
  update(patch: Record<string, unknown>): EventsBuilder;
  insert(rows: Record<string, unknown> | Record<string, unknown>[], opts?: { ignoreDuplicates?: boolean }): EventsBuilder;
  eq(col: string, val: unknown): EventsBuilder;
  is(col: string, val: unknown): EventsBuilder;
  in(col: string, vals: unknown[]): EventsBuilder;
  order(col: string, opts?: { ascending?: boolean }): EventsBuilder;
  maybeSingle(): Promise<QueryResult>;
};

function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function istStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** Smallest, deterministic, browser-openable receipt built ONLY from stored facts. */
function buildReceiptHtml(input: {
  event: DeliveryRow;
  source: PaymentSource;
  member: MemberContact;
  tax: TaxConfig | null;
}): string {
  const { event, source, member, tax } = input;
  const hasCompleteTax =
    tax &&
    tax.seller_legal_name &&
    tax.seller_gstin &&
    tax.seller_address &&
    tax.tax_label &&
    tax.tax_rate !== null;

  const refs = [
    source.utr_reference ? `<div>Payment reference (UTR): ${esc(source.utr_reference)}</div>` : "",
    event.gateway_order_id ? `<div>Gateway order id: ${esc(event.gateway_order_id)}</div>` : "",
    event.gateway_payment_id ? `<div>Gateway payment id: ${esc(event.gateway_payment_id)}</div>` : "",
  ].join("");

  const taxBlock = hasCompleteTax
    ? `<div style="border-top:1px solid #ddd;margin-top:12px;padding-top:8px">
         <strong>Configured tax information</strong>
         <div>Seller: ${esc(tax!.seller_legal_name)}</div>
         <div>Seller GSTIN: ${esc(tax!.seller_gstin)}</div>
         <div>Seller address: ${esc(tax!.seller_address)}</div>
         <div>Configured tax: ${esc(tax!.tax_label)} at ${esc(tax!.tax_rate)}%</div>
       </div>`
    : `<div style="border-top:1px solid #ddd;margin-top:12px;padding-top:8px">
         Tax configuration unavailable — tax is not included in this receipt.
       </div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Payment receipt — Sri Lakshmi Mangalya Malai</title>
</head><body style="font-family:Georgia,serif;color:#2b2b2b;max-width:640px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 4px">Sri Lakshmi Mangalya Malai</h1>
<div style="color:#6b6b6b;font-size:13px">Payment receipt</div>
<div style="margin-top:20px;border:1px solid #ddd;padding:16px">
  <div><strong>Payment ID:</strong> ${esc(event.payment_id)}</div>
  <div><strong>Verified on:</strong> ${esc(istStamp(event.verified_at))} (IST)</div>
  <div><strong>Client:</strong> ${esc(member.full_name ?? event.user_id)}</div>
  <div><strong>Item / plan:</strong> ${esc(event.item)}</div>
  <div><strong>Amount:</strong> ₹${esc(event.amount_inr)}</div>
  <div><strong>Method:</strong> ${esc(source.method ?? "—")}</div>
  ${refs}
</div>${taxBlock}
<div style="margin-top:16px;color:#999;font-size:11px">This receipt is generated from stored payment records.</div>
</body></html>`;
}

async function signR2Put(key: string, contentType: string): Promise<string> {
  const accountId = process.env["R2_ACCOUNT_ID"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  const bucket = process.env["R2_BUCKET_NAME"];
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Cloud storage is not configured yet.");
  }
  const { AwsClient } = await import("aws4fetch");
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}?X-Amz-Expires=900`);
  const signed = await client.sign(
    new Request(url, { method: "PUT", headers: { "content-type": contentType } }),
    { aws: { signQuery: true } },
  );
  return signed.url;
}

/** Determininistic, owner-scoped receipt key. */
function receiptKey(event: DeliveryRow): string {
  return `${event.user_id}/receipts/${event.payment_id}-receipt.html`;
}

async function storeReceipt(event: DeliveryRow, html: string): Promise<string> {
  const key = receiptKey(event);
  const putUrl = await signR2Put(key, "text/html");
  const res = await fetch(putUrl, {
    method: "PUT",
    headers: { "content-type": "text/html" },
    body: html,
  });
  if (!res.ok) throw new Error(`Receipt store failed (${res.status})`);
  return key;
}

/**
 * Sends the payment-verified client notification (reuses the existing email
 * template + notifications outbox). Idempotent: deterministic provider
 * idempotency key, and email retries UPDATE the existing record instead of
 * duplicating rows.
 */
async function sendPaymentVerifiedNotification(
  event: DeliveryRow,
  member: MemberContact,
): Promise<{ sent: boolean; reason?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!member.email) return { sent: false, reason: "no email on profile" };
  const memberEmail = member.email;

  const { data: existing } = await supabaseAdmin
    .from("notifications")
    .select("id, emailed")
    .eq("kind", "payment_verified_member")
    .eq("related_user_id", event.user_id)
    .maybeSingle();
  if (existing?.emailed) return { sent: true };
  const rowId = existing?.id ?? null;

  const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
  const subject = "Your payment was verified — receipt available";
  const body = `Your ${event.item} payment of ₹${event.amount_inr} was verified. Open the Payments page in your account to view and download your receipt.`;

  const recordFailure = async (reason: string) => {
    if (rowId) {
      await supabaseAdmin.from("notifications").update({ emailed: false, email_error: reason }).eq("id", rowId);
    } else {
      await supabaseAdmin.from("notifications").insert({
        kind: "payment_verified_member",
        subject,
        body,
        email_to: memberEmail,
        related_user_id: event.user_id,
        emailed: false,
        email_error: reason,
      });
    }
  };

  try {
    const result = await sendTemplateEmail("payment-verified", memberEmail, {
      templateData: {
        fullName: member.full_name ?? "Member",
        paymentId: event.payment_id,
        item: event.item,
        amount: event.amount_inr,
        verifiedAt: event.verified_at,
      },
      idempotencyKey: `payment-verified-${event.payment_id}`,
    });
    if (result.sent) {
      if (rowId) {
        await supabaseAdmin.from("notifications").update({ emailed: true, email_error: null }).eq("id", rowId);
      } else {
        await supabaseAdmin.from("notifications").insert({
          kind: "payment_verified_member",
          subject,
          body,
          email_to: memberEmail,
          related_user_id: event.user_id,
          emailed: true,
        });
      }
      return { sent: true };
    }
    await recordFailure(result.reason);
    return { sent: false, reason: result.reason };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "send failed";
    await recordFailure(reason);
    return { sent: false, reason };
  }
}

/**
 * Processes one pass of pending delivery work. Retryable and crash-safe:
 *  - claims are compare-and-swap on the attempt counter (receipt_key null guard
 *    for receipts; status guard for notifications),
 *  - a crashed run never leaves a stuck "processing" state (status remains
 *    'pending' until one of the terminal states is committed),
 *  - payment verification is never reversed.
 */
export async function processPendingPaymentDeliveries(opts?: {
  paymentId?: string;
}): Promise<{ receipts: number; notifications: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const events = (supabaseAdmin as unknown as {
    from(table: string): EventsBuilder;
  }).from("payment_events");

  const { data } = await events.select("*").order("verified_at", { ascending: true });
  const nowIso = new Date().toISOString();
  const ALL = ((data as DeliveryRow[]) ?? []).filter((r) =>
    opts?.paymentId ? r.payment_id === opts.paymentId : true,
  );

  let receipts = 0;
  let notifications = 0;

  for (const row of ALL) {
    const needsReceipt =
      (row.receipt_status === "pending" || row.receipt_status === "failed") &&
      (row.receipt_attempts ?? 0) < MAX_DELIVERY_ATTEMPTS &&
      !row.receipt_key;

    if (needsReceipt) {
      const { data: claimed } = await events
        .update({
          receipt_attempts: (row.receipt_attempts ?? 0) + 1,
          receipt_lease_until: new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString(),
          receipt_processed_at: nowIso,
        })
        .eq("payment_id", row.payment_id)
        .in("receipt_status", ["pending", "failed"])
        .eq("receipt_attempts", row.receipt_attempts ?? 0)
        .is("receipt_key", null)
        .maybeSingle();
      if (!claimed) continue;

      try {
        const { data: payment } = await supabaseAdmin
          .from("payments")
          .select("method, utr_reference")
          .eq("id", claimed.payment_id)
          .maybeSingle();
        const { data: member } = await supabaseAdmin
          .from("profiles")
          .select("full_name, email")
          .eq("id", claimed.user_id)
          .maybeSingle();
        const taxClient = (supabaseAdmin as unknown as {
      from(table: string): EventsBuilder;
    }).from("payment_tax_config");
        const { data: tax } = await taxClient.select("*").eq("item", claimed.item).maybeSingle();

        const html = buildReceiptHtml({
          event: claimed,
          source: (payment ?? { method: null, utr_reference: null }) as PaymentSource,
          member: (member ?? { full_name: null, email: null }) as MemberContact,
          tax: (tax ?? null) as TaxConfig | null,
        });
        const key = await storeReceipt(claimed, html);

        const { data: committed } = await events
          .update({
            receipt_status: "generated",
            receipt_key: key,
            receipt_error: null,
            receipt_lease_until: null,
          })
          .eq("payment_id", claimed.payment_id)
          .is("receipt_key", null)
          .maybeSingle();
        if (committed) receipts++;
      } catch (err) {
        const message = err instanceof Error ? err.message : "receipt generation failed";
        await events
          .update({ receipt_status: "failed", receipt_error: message, receipt_lease_until: null })
          .eq("payment_id", claimed.payment_id);
      }
    }

    const needsNotification =
      (row.notification_status === "pending" || row.notification_status === "failed") &&
      (row.notification_attempts ?? 0) < MAX_DELIVERY_ATTEMPTS;

    if (needsNotification) {
      const { data: claimed } = await events
        .update({
          notification_attempts: (row.notification_attempts ?? 0) + 1,
        })
        .eq("payment_id", row.payment_id)
        .in("notification_status", ["pending", "failed"])
        .eq("notification_attempts", row.notification_attempts ?? 0)
        .maybeSingle();
      if (!claimed) continue;

      const { data: member } = await supabaseAdmin
        .from("profiles")
        .select("full_name, email")
        .eq("id", claimed.user_id)
        .maybeSingle();
      const result = await sendPaymentVerifiedNotification(
        claimed,
        (member ?? { full_name: null, email: null }) as MemberContact,
      );
      if (result.sent) {
        await events
          .update({ notification_status: "sent", notification_sent_at: nowIso, notification_error: null })
          .eq("payment_id", claimed.payment_id);
        notifications++;
      } else {
        await events
          .update({ notification_status: "failed", notification_error: result.reason ?? "send failed" })
          .eq("payment_id", claimed.payment_id);
      }
    }
  }

  return { receipts, notifications };
}

/**
 * Admin-only retry: reset failed/pending delivery state for a payment (or all
 * payments when paymentId is omitted) and run one processing pass. Never
 * touches payment verification or membership.
 */
export const retryPaymentDeliveries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ paymentId: z.string().uuid().nullish() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const events = (supabaseAdmin as unknown as {
    from(table: string): EventsBuilder;
  }).from("payment_events");

    const q1 = data.paymentId
      ? events
          .update({ receipt_status: "pending", receipt_error: null, receipt_lease_until: null, receipt_attempts: 0 })
          .eq("payment_id", data.paymentId)
          .in("receipt_status", ["pending", "failed"])
          .is("receipt_key", null)
      : events
          .update({ receipt_status: "pending", receipt_error: null, receipt_lease_until: null, receipt_attempts: 0 })
          .in("receipt_status", ["pending", "failed"])
          .is("receipt_key", null);
    await q1;

    const q2 = data.paymentId
      ? events
          .update({ notification_status: "pending", notification_error: null, notification_attempts: 0 })
          .eq("payment_id", data.paymentId)
          .in("notification_status", ["pending", "failed"])
      : events
          .update({ notification_status: "pending", notification_error: null, notification_attempts: 0 })
          .in("notification_status", ["pending", "failed"]);
    await q2;

    const summary = await processPendingPaymentDeliveries(
      data.paymentId ? { paymentId: data.paymentId } : undefined,
    );
    return summary;
  });