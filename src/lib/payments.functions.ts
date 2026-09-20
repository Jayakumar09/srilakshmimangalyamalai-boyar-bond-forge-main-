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

    const { error } = await context.supabase.from("payments").insert({
      user_id: context.userId,
      item: data.item,
      amount_inr: amount,
      method: "online",
      gateway_order_id: order.id,
      status: "submitted",
    });
    if (error) throw new Error(error.message);

    return { orderId: order.id, amount, keyId };
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
    const { data: payment, error } = await supabaseAdmin
      .from("payments")
      .update({
        status: "verified",
        gateway_payment_id: data.paymentId,
        verified_at: new Date().toISOString(),
      })
      .eq("gateway_order_id", data.orderId)
      .eq("user_id", context.userId)
      .select("item, amount_inr")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!payment) throw new Error("Payment record not found");

    if (payment.item === "standard" || payment.item === "premium") {
      const validUntil = new Date();
      validUntil.setFullYear(validUntil.getFullYear() + 1);
      await supabaseAdmin
        .from("profiles")
        .update({
          membership_plan: payment.item,
          plan_valid_until: validUntil.toISOString().slice(0, 10),
        })
        .eq("id", context.userId);
    }

    await supabaseAdmin.from("notifications").insert({
      kind: "payment_online",
      subject: `Online payment received — ₹${payment.amount_inr} (${payment.item})`,
      body: `An online ${payment.item} payment of ₹${payment.amount_inr} was completed and verified automatically. Gateway payment id: ${data.paymentId}.`,
      email_to: "vijayalakshmi@srilakshmimangalyamalai.com",
      related_user_id: context.userId,
    });

    return { ok: true, item: payment.item };
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
      .select("user_id, item")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!payment) throw new Error("Payment not found");

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

    return { ok: true };
  });
