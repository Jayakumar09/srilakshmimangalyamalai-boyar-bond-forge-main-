import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runBackgroundTask } from "@/lib/background-task";

export const PRICES = { standard: 2000, premium: 5000, jathagam: 500 } as const;
export type PayItem = keyof typeof PRICES;

const ItemSchema = z.enum(["standard", "premium", "jathagam"]);

/** Returns Direct Bank Transfer details for authenticated customers. */
export const getBankTransferDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ item: ItemSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const beneficiary = process.env["BANK_BENEFICIARY"];
    const accountNumber = process.env["BANK_ACCOUNT_NUMBER"];
    const ifsc = process.env["BANK_IFSC"];
    const micr = process.env["BANK_MICR"];
    const mobile = process.env["BANK_MOBILE"];

    if (!beneficiary || !accountNumber || !ifsc) {
      throw new Error("Bank transfer details are not configured.");
    }

    return {
      beneficiary,
      accountNumber,
      ifsc,
      micr: micr ?? null,
      mobile: mobile ?? null,
      amount: PRICES[data.item],
    };
  });

// The outbox insert in reviewPayment is the one step whose loss is
// unrecoverable, and the one step that can fail for reasons unrelated to a
// rejected write. Bounded attempts keep a transient storage fault from
// stranding an already-verified payment.
const OUTBOX_INSERT_ATTEMPTS = 3;
const OUTBOX_RETRY_DELAY_MS = 250;

/**
 * Online (Razorpay) checkout is not an approved payment method for the current
 * release, so this handler fails closed: no Razorpay order is requested and no
 * 'online' payment row is ever inserted. The manual UPI / direct bank transfer
 * path (submitManualPayment) and getBankTransferDetails are unaffected.
 */
export const createPaymentOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ item: ItemSchema }).parse(input))
  .handler(() => {
    throw new Error("ONLINE_PAYMENTS_UNAVAILABLE");
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
        method: z.enum(["upi", "bank_transfer"]),
        utrReference: z.string().min(1).max(120),
        proofKey: z.string().max(300).nullable(),
      })
      .refine(
        (v) => v.method !== "bank_transfer" || v.utrReference.trim().length > 0,
        { message: "UTR_REQUIRED_BANK_TRANSFER", path: ["utrReference"] },
      )
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const normalizedUtr = data.utrReference.trim().toUpperCase();
    const { data: inserted, error } = await supabaseAdmin
      .from("payments")
      .insert({
        user_id: context.userId,
        item: data.item,
        amount_inr: PRICES[data.item],
        method: data.method,
        utr_reference: normalizedUtr,
        proof_key: data.proofKey ?? null,
        status: "submitted",
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error("UTR_DUPLICATE");
      }
      if (error.code === "23514") {
        throw new Error("UTR_INVALID");
      }
      throw new Error(error.message);
    }
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
    // never reverses the completed verification. It is attached to the Worker
    // lifecycle (waitUntil) so the response can return while delivery finishes,
    // instead of a detached promise the runtime may drop.
    await runBackgroundTask(async () => {
      const m = await import("@/lib/receipts.functions");
      await m.processPendingPaymentDeliveries({ paymentId: paidPaymentId });
    });
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
        .eq("id", payment.user_id)
        .then(({ error }) => {
          // PostgREST reports a rejected write (for example the admin
          // membership-plan guard answering 42501) in the returned error
          // instead of throwing, so an unchecked update let this handler
          // answer { ok: true } for a payment that granted no membership
          // at all. The payment itself stays terminally 'verified' -- it is
          // not rolled back here -- but the failure is now surfaced so the
          // admin never sees a false "Payment verified" confirmation.
          if (error) throw new Error(error.message);
        });
    }

    // Both verification paths must produce the authoritative PAYMENT_VERIFIED
    // event. Guarded insert (unique payment_id): a repeated admin verification
    // never creates a duplicate event.
    //
    // Ordering matters: by this point the payment is terminally 'verified' and
    // the plan is already active, and neither write can be replayed because
    // the status guard only claims 'submitted' rows. This event row is also the
    // only thing receipt/notification delivery reads, and
    // retryPaymentDeliveries can only recover an event that exists -- so a lost
    // insert used to leave the payment verified with no receipt, no
    // notification and no way to repair it short of a manual database write,
    // all behind a raw storage error that read as if the verification itself
    // had failed.
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
      const event = {
        payment_id: data.paymentId,
        user_id: payment.user_id,
        item: payment.item,
        amount_inr: payment.amount_inr,
        kind: "PAYMENT_VERIFIED",
        gateway_order_id: null,
        gateway_payment_id: null,
        verified_at: payment.verified_at,
      };
      // Every field is derived from the row this handler just claimed, and
      // unique(payment_id) turns a duplicate into a no-op, so retrying cannot
      // double-write and cannot undo an attempt that already succeeded.
      let evError: { message: string } | null = null;
      for (let attempt = 1; attempt <= OUTBOX_INSERT_ATTEMPTS; attempt += 1) {
        evError = (await evClient.insert(event, { ignoreDuplicates: true })).error;
        if (!evError) break;
        if (attempt < OUTBOX_INSERT_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, OUTBOX_RETRY_DELAY_MS * attempt));
        }
      }
      if (evError) {
        // The completed transition is deliberately not rolled back here, so
        // the failure is reported with its real consequence instead of the bare
        // storage message: the payment stands, membership stands, and what is
        // missing is the receipt/notification event this payment now needs.
        throw new Error(
          `Payment ${data.paymentId} is verified and the membership plan is active, but its receipt/notification event could not be recorded (${evError.message}). No receipt or notification will be sent for this payment until that event row is created, and re-running this review cannot create it because the payment is no longer awaiting review.`,
        );
      }

      // Receipt + notification delivery is downstream, best-effort and never
      // reverses the completed verification. It is attached to the Worker
      // lifecycle (waitUntil) so the response can return while delivery
      // finishes, instead of a detached promise the runtime may drop.
      await runBackgroundTask(async () => {
        const m = await import("@/lib/receipts.functions");
        await m.processPendingPaymentDeliveries({ paymentId: data.paymentId });
      });
    }

    return { ok: true };
  });
