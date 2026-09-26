-- payment_b1_atomic_verification
-- B1: make the online payment verification a SINGLE transactional business
-- transition instead of three separate service-role statements.
--
-- Problem closed: the old confirmPaymentOrder marked a payment 'verified' and
-- then, in separate statements, activated the plan and inserted the
-- notification. A failure between those steps could leave a VERIFIED payment
-- with no membership and/or no notification, and the alreadyProcessed
-- fast-path then permanently blocked recovery.
--
-- This migration:
--   1. Adds public.payment_events: an exactly-once durable outbox row
--      (PAYMENT_VERIFIED) carrying the receipt metadata a later receipt/tax
--      step needs. unique(payment_id) guarantees at most one event per payment.
--   2. Adds public.verify_payment(text, uuid, text): a SECURITY DEFINER RPC
--      that performs the whole transition inside ONE transaction. If any step
--      fails, the entire transaction rolls back and the payment stays
--      'submitted'; membership is not activated and nothing is left partially
--      created.
--
-- External side effects (PDF/email/gateway calls) must NOT happen inside this
-- transaction; only durable state is written. Receipt/notification delivery is
-- a later retryable step that reads payment_events.
--
-- NOTE: This migration is APPLIED to production (project
-- sxpkutjkqfekqwpabgrk; verified 2026-09-26) and is part of the intended end
-- state. Do not re-apply: it is not idempotent.

-- ---------------------------------------------------------------------------
-- Exactly-once outbox + receipt metadata for a verified payment.
-- ---------------------------------------------------------------------------
CREATE TABLE public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  item public.payment_item NOT NULL,
  amount_inr integer NOT NULL,
  kind text NOT NULL DEFAULT 'PAYMENT_VERIFIED',
  gateway_order_id text,
  gateway_payment_id text,
  verified_at timestamptz NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.payment_events TO service_role;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Transactional business transition for online payment verification.
-- Returns exactly one row:
--   payment_id       null when no payment matches gateway_order_id + user_id
--   verified         true  => this request performed the transition
--   already_processed true => payment was already verified (replay)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX payments_gateway_order_user_uniq
ON public.payments (gateway_order_id, user_id)
WHERE gateway_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.verify_payment(
  p_gateway_order_id text,
  p_user_id uuid,
  p_gateway_payment_id text
)
RETURNS TABLE (
  payment_id uuid,
  item public.payment_item,
  amount_inr integer,
  verified boolean,
  already_processed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_valid_until date;
  v_match_count bigint;
BEGIN
  SELECT count(*)
    INTO v_match_count
    FROM public.payments
    WHERE gateway_order_id = p_gateway_order_id
      AND user_id = p_user_id;

  IF v_match_count > 1 THEN
    RAISE EXCEPTION 'multiple payments match gateway order and user';
  END IF;

  -- Atomic claim: only one concurrent invocation can transition this payment
  -- from 'submitted' to 'verified'. The WHERE clause carries the identity
  -- (gateway_order_id + user_id) AND the status guard, so a second
  -- simultaneous invocation matches zero rows after the first commits.
  UPDATE public.payments
     SET status = 'verified',
         gateway_payment_id = p_gateway_payment_id,
         verified_at = now()
   WHERE gateway_order_id = p_gateway_order_id
     AND user_id = p_user_id
     AND status = 'submitted'
   RETURNING * INTO v_payment;

  IF v_payment.id IS NULL THEN
    -- Nothing claimed: distinguish a replay from a wrong/missing identity.
    SELECT * INTO v_payment
      FROM public.payments
     WHERE gateway_order_id = p_gateway_order_id
       AND user_id = p_user_id;

    IF v_payment.id IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, NULL::public.payment_item, NULL::integer, false, false;
      RETURN;
    END IF;

    IF v_payment.status = 'verified' THEN
      RETURN QUERY SELECT v_payment.id, v_payment.item, v_payment.amount_inr, false, true;
      RETURN;
    END IF;

    RAISE EXCEPTION 'payment cannot be verified (status is %)', v_payment.status;
  END IF;

  -- Activate the applicable plan exactly once. Only the claiming request can
  -- reach this point, so a replayed verification cannot re-extend membership.
  IF v_payment.item IN ('standard', 'premium') THEN
    v_valid_until := (now() + interval '1 year')::date;
    UPDATE public.profiles
       SET membership_plan = v_payment.item,
           plan_valid_until = v_valid_until
     WHERE id = p_user_id;
  END IF;

  -- Preserve the existing admin alert; it is now part of the same transaction.
  INSERT INTO public.notifications (kind, subject, body, email_to, related_user_id)
  VALUES (
    'payment_online',
    'Online payment received — ₹' || v_payment.amount_inr || ' (' || v_payment.item || ')',
    'An online ' || v_payment.item || ' payment of ₹' || v_payment.amount_inr
      || ' was completed and verified automatically. Gateway payment id: '
      || p_gateway_payment_id || '.',
    'vijayalakshmi@srilakshmimangalyamalai.com',
    p_user_id
  );

  -- Exactly-once client outbox + receipt metadata. unique(payment_id) makes a
  -- duplicate event impossible; a duplicate would raise and roll everything back.
  INSERT INTO public.payment_events
    (payment_id, user_id, item, amount_inr, kind, gateway_order_id, gateway_payment_id, verified_at)
  VALUES
    (v_payment.id, p_user_id, v_payment.item, v_payment.amount_inr,
     'PAYMENT_VERIFIED', v_payment.gateway_order_id, p_gateway_payment_id, v_payment.verified_at);

  RETURN QUERY SELECT v_payment.id, v_payment.item, v_payment.amount_inr, true, false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_payment(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_payment(text, uuid, text) TO service_role;