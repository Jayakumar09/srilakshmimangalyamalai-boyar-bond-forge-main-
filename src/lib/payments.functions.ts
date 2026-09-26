import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const PRICES = { standard: 2000, premium: 5000, jathagam: 500 } as const;
export type PayItem = keyof typeof PRICES;

const ItemSchema = z.enum(["standard", "premium", "jathagam"]);

/** Creates a Razorpay order and a matching pending payment row. */
export const createPaymentOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ item: ItemSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const keyId = process.env["RAZORPAY_KEY_ID"];
    const keySecret = process.env["RAZORPAY_KEY_SECRET"];
    if (!keyId || !keySecret) {
      throw new Error("ONLINE_PAYMENTS_UNAVAILABLE");
    }

    const amount = PRICES[data.item];

    // Already-purchased and still-active plans must not be bought again:
    // a fresh verification would overwrite (not extend) the current validity
    // window, and repeated orders would pile up pending payment rows.
    if (data.item === "standard" || data.item === "premium") {
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("membership_plan, plan_valid_until")
        .eq("id", context.userId)
        .maybeSingle();
      if (profile?.membership_plan === data.item && profile.plan_valid_until) {
        const expiry = new Date(`${profile.plan_valid_until}T00:00:00`);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (expiry.getTime() >= today.getTime()) {
          throw new Error("This plan is already active on your account.");
        }
      }
    }

    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      },
      body: JSON.stringify({
        amount: amount * 100,
        currency: "INR",
        receipt: `${data.item}-${context.userId.slice(0, 8)}-${Date.now()}`,
        notes: { item: data.item, user_id: context.userId },
      }),
    });
    if (!res.ok) {
      throw new Error(`Payment gateway error (${res.status})`);
    }
    const order = (await res.json()) as { id: string };

    // Payment rows are created with the service role (never with the session
    // client, whose INSERT privilege is revoked): amount, method and status
    // are therefore always server-authored.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error } = await supabaseAdmin
      .from("payments")
      .insert({
        user_id: context.userId,
        item: data.item,
        amount_inr: amount,
        method: "online",
        gateway_order_id: order.id,
        status: "submitted",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return { orderId: order.id, paymentId: inserted.id, amount, keyId };
  });

/**
 * Records a manual payment submission. The amount is computed server-side from
 * the fixed price list and the status is always 'submitted', so a client can
 * never insert a payment row carrying invented payment facts.
 */
export const submitManualPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        item: ItemSchema,
        method: z.enum(["upi", "card", "bank"]),
        utrReference: z.string().min(1).max(120),
        proofKey: z.string().max(300).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error } = await supabaseAdmin
      .from("payments")
      .insert({
        user_id: context.userId,
        item: data.item,
        amount_inr: PRICES[data.item],
        method: data.method,
        utr_reference: data.utrReference,
        proof_key: data.proofKey ?? null,
        status: "submitted",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { paymentId: inserted.id };
  });

async function hmacSha256Hex(secret: string, message: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Verifies the gateway signature and activates the plan immediately. */
export const confirmPaymentOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        orderId: z.string().min(1),
        paymentId: z.string().min(1),
        signature: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const keySecret = process.env["RAZORPAY_KEY_SECRET"];
    if (!keySecret) throw new Error("ONLINE_PAYMENTS_UNAVAILABLE");

    const expected = await hmacSha256Hex(keySecret, `${data.orderId}|${data.paymentId}`);
    if (expected !== data.signature) throw new Error("Payment signature could not be verified");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // The whole business transition -- mark verified, activate the plan, admin
    // alert, exactly-once PAYMENT_VERIFIED outbox + receipt metadata -- runs
    // inside the database in one transaction (verify_payment). If any step
    // fails, everything rolls back and the payment stays 'submitted'.
    const adminClient = supabaseAdmin as unknown as {
      rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data: rows, error } = await adminClient.rpc("verify_payment", {
      p_gateway_order_id: data.orderId,
      p_user_id: context.userId,
      p_gateway_payment_id: data.paymentId,
    });
    if (error) throw new Error(error.message);

    const row = (Array.isArray(rows) ? rows[0] : rows) as
      | ({ payment_id: string | null; item: PayItem; amount_inr: number; verified: boolean; already_processed: boolean } | null)
      | null;
    if (!row || !row.payment_id) throw new Error("Payment record not found");
    const paidPaymentId = row.payment_id;
    if (!row.verified) {
      return { ok: true, item: row.item, alreadyProcessed: true };
    }
    // Receipt + client notification delivery is downstream, best-effort and
    // never blocks or reverses the completed verification.
    void import("@/lib/receipts.functions").then((m) =>
      m.processPendingPaymentDeliveries({ paymentId: paidPaymentId }).catch(() => {}),
    );
    return { ok: true, item: row.item };
  });

/** Admin: verify or reject a manually submitted payment and set the plan. */
export const reviewPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        paymentId: z.string().uuid(),
        decision: z.enum(["verified", "rejected"]),
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

    const { data: payment, error } = await context.supabase
      .from("payments")
      .update({
        status: data.decision,
        admin_notes: data.note,
        verified_at: data.decision === "verified" ? new Date().toISOString() : null,
      })
      .eq("id", data.paymentId)
      // The status guard belongs on the write itself, not only on the UI that
      // offers review actions for 'submitted' rows: without it an admin
      // session could re-drive an already-decided payment back to 'verified',
      // re-extending membership, and would do so silently because the
      // payment_events insert is ignoreDuplicates-guarded. This predicate is
      // evaluated inside the same UPDATE, so it also acts as the compare-and-
      // swap that keeps 'verified' and 'rejected' terminal here, matching the
      // claim predicate verify_payment() already uses.
      .eq("status", "submitted")
      .select("user_id, item, amount_inr, verified_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!payment) throw new Error("Payment is not awaiting review");

    if (data.decision === "verified" && (payment.item === "standard" || payment.item === "premium")) {
      const validUntil = new Date();
      validUntil.setFullYear(validUntil.getFullYear() + 1);
      await context.supabase
        .from("profiles")
        .update({
          membership_plan: payment.item,
          plan_valid_until: validUntil.toISOString().slice(0, 10),
        })
        .eq("id", payment.user_id);
    }

    // Both verification paths must produce the authoritative PAYMENT_VERIFIED
    // event. Guarded insert (unique payment_id): a repeated admin verification
    // never creates a duplicate event.
    if (data.decision === "verified") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const evClient = (supabaseAdmin as unknown as {
        from(table: string): unknown;
      }).from("payment_events") as unknown as {
        insert(
          row: Record<string, unknown>,
          opts?: { ignoreDuplicates?: boolean },
        ): Promise<{ error: { message: string } | null }>;
      };
      const { error: evError } = await evClient.insert(
        {
          payment_id: data.paymentId,
          user_id: payment.user_id,
          item: payment.item,
          amount_inr: payment.amount_inr,
          kind: "PAYMENT_VERIFIED",
          gateway_order_id: null,
          gateway_payment_id: null,
          verified_at: payment.verified_at,
        },
        { ignoreDuplicates: true },
      );
      if (evError) throw new Error(evError.message);

      // Receipt + notification delivery is downstream, best-effort and never
      // blocks or reverses the completed verification.
      void import("@/lib/receipts.functions").then((m) =>
        m.processPendingPaymentDeliveries({ paymentId: data.paymentId }).catch(() => {}),
      );
    }

    return { ok: true };
  });
