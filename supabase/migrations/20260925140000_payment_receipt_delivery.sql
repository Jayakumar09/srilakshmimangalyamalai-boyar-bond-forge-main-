-- payment_receipt_delivery
-- Downstream, RETRYABLE delivery for PAYMENT_VERIFIED events: receipt
-- generation (private R2) and the client notification run AFTER and
-- INDEPENDENT of the atomic verification (B1). They share the payment_events
-- row as the durable outbox + processing state, and they can NEVER reverse a
-- completed payment verification.
--
-- APPLIED to production (project sxpkutjkqfekqwpabgrk; verified 2026-09-26)
-- and part of the intended end state. Do not re-apply: it is not idempotent.

-- ---------------------------------------------------------------------------
-- Delivery state on the authoritative PAYMENT_VERIFIED event (exactly-once per
-- payment: unique payment_id from the B1 migration).
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_events
  ADD COLUMN receipt_status text NOT NULL DEFAULT 'pending'
    CHECK (receipt_status IN ('pending', 'generated', 'failed')),
  ADD COLUMN receipt_key text UNIQUE,
  ADD COLUMN receipt_error text,
  ADD COLUMN receipt_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN receipt_processed_at timestamptz,
  ADD COLUMN receipt_lease_until timestamptz,
  ADD COLUMN notification_status text NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending', 'sent', 'failed')),
  ADD COLUMN notification_error text,
  ADD COLUMN notification_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN notification_sent_at timestamptz;

-- Clients may read ONLY their own event rows (receipt availability + key).
-- They can never insert/update payment_events - processing stays service-role.
GRANT SELECT ON public.payment_events TO authenticated;
CREATE POLICY "own payment_events select" ON public.payment_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Admins may inspect delivery state from the existing admin payments view.
CREATE POLICY "admins payment_events select" ON public.payment_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Explicitly-stored business/tax configuration. Receipt rendering reads ONLY
-- these configured values; it never computes, invents, or assumes tax data.
-- When a row is absent or incomplete the receipt marks tax as not included.
-- ---------------------------------------------------------------------------
CREATE TABLE public.payment_tax_config (
  item public.payment_item PRIMARY KEY,
  seller_legal_name text,
  seller_gstin text,
  seller_address text,
  tax_label text,
  tax_rate numeric,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_tax_config TO authenticated;
GRANT ALL ON public.payment_tax_config TO service_role;
ALTER TABLE public.payment_tax_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins tax config" ON public.payment_tax_config
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));