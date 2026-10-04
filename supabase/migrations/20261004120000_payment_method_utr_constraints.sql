-- payment_method_utr_constraints
-- Operation 3/6: Add payment method constraints, UTR normalization, and duplicate protection.
--
-- This migration:
--   1. Normalizes existing UTR references (trim + upper) for manual payments.
--   2. Restricts payment.method to allowed values: 'online', 'upi', 'bank_transfer'.
--   3. Enforces UTR reference max length of 120 characters.
--   4. Adds unique index on normalized UTR per user+item for manual payments.
--   5. Adds partial unique index preventing multiple 'submitted' manual payments per user+item.
--
-- Existing online payments (method='online') are preserved unchanged.
-- NULL UTR is allowed for online payments; manual payments require non-empty UTR at application level.
--
-- NOTE: Do not apply until reviewed. Not idempotent.

-- ---------------------------------------------------------------------------
-- 1. Normalize existing UTR references for manual payment methods.
--    Only affects rows where method IN ('upi','bank','bank_transfer') and utr_reference is not null.
-- ---------------------------------------------------------------------------
UPDATE public.payments
SET utr_reference = upper(trim(utr_reference))
WHERE method IN ('upi', 'bank', 'bank_transfer')
  AND utr_reference IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Restrict payment.method to supported values.
--    Existing 'online' rows are preserved. Legacy 'card'/'bank' values are not
--    present in production (inserts were server-side only), but the CHECK
--    allows only the three canonical methods going forward.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments
ADD CONSTRAINT payments_method_allowed
CHECK (method IN ('online', 'upi', 'bank_transfer'));

-- ---------------------------------------------------------------------------
-- 3. Enforce UTR reference max length (120 chars) at database level.
--    Matches application-level Zod validation.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments
ADD CONSTRAINT payments_utr_reference_maxlen
CHECK (utr_reference IS NULL OR length(utr_reference) <= 120);

-- ---------------------------------------------------------------------------
-- 4. Unique index on normalized UTR per user+item for manual payments.
--    Prevents duplicate UTR submissions for the same user and item.
--    Applies only to manual methods where UTR is provided.
--    Normalization (upper+trim) is done at insert time by application,
--    but the index expression ensures DB-level enforcement matches.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX payments_manual_utr_user_item_uniq
ON public.payments (user_id, item, upper(trim(utr_reference)))
WHERE method IN ('upi', 'bank_transfer')
  AND utr_reference IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Partial unique index preventing multiple 'submitted' manual payments
--    for the same user_id + item combination.
--    Ensures a user cannot have more than one pending manual payment
--    for the same plan/item at a time.
--    Online payments (method='online') are excluded since they use
--    gateway_order_id for deduplication (payments_gateway_order_user_uniq).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX payments_manual_submitted_user_item_uniq
ON public.payments (user_id, item)
WHERE method IN ('upi', 'bank_transfer')
  AND status = 'submitted';

-- ---------------------------------------------------------------------------
-- 6. (Defense in depth) Ensure UTR is non-empty for manual payments at DB level.
--    This is primarily enforced at application level (submitManualPayment Zod
--    refine), but a CHECK constraint adds a safety net for any direct DB writes.
--    Online payments are exempt (utr_reference may be NULL).
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments
ADD CONSTRAINT payments_manual_utr_required
CHECK (
  method NOT IN ('upi', 'bank_transfer')
  OR (utr_reference IS NOT NULL AND trim(utr_reference) <> '')
);

-- ---------------------------------------------------------------------------
-- Documentation: payment method values and their UTR semantics
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.payments.method IS
'Payment method: online (Razorpay), upi (manual UPI), bank_transfer (manual bank transfer). '
'UTR reference required for upi and bank_transfer; NULL for online.';

COMMENT ON COLUMN public.payments.utr_reference IS
'Unique Transaction Reference from payment provider. '
'Stored normalized (trim + upper). Required for manual methods (upi, bank_transfer). '
'Max 120 characters. Unique per user+item for manual payments.';