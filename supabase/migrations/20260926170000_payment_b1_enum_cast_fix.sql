-- payment_b1_enum_cast_fix
-- Corrects the enum type mismatch in public.verify_payment(text, uuid, text)
-- introduced by 20260925130000_payment_b1_atomic.sql.
--
-- ROOT CAUSE: The B1 migration assigns payment_item (enum: standard, premium, jathagam)
-- directly to profiles.membership_plan (enum: free, standard, premium).
-- PostgreSQL rejects cross-enum assignment even when labels match.
--
-- FIX: Cast through text to convert the compatible enum values.
-- The existing IF guard already limits to 'standard' and 'premium', which exist in both enums.
-- jathagam is correctly excluded by the guard and does not activate a membership plan.
--
-- HISTORICAL CONTEXT:
-- 20260925130000_payment_b1_atomic.sql is ALREADY APPLIED to production
-- (project sxpkutjkqfekqwpabgrk; verified 2026-09-26). Do not modify that migration.
-- This is a separate corrective migration.
--
-- This migration uses CREATE OR REPLACE FUNCTION to fix only the enum conversion.
-- All other behavior, grants, and transaction semantics are preserved.
-- The E3 privilege hardening (20260926150000/20260926160000) remains in force:
-- REVOKE ... FROM PUBLIC, anon, authenticated; GRANT ... TO service_role.
-- Those grants are NOT repeated here because CREATE OR REPLACE preserves the function OID and ACL.

BEGIN;

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
       SET membership_plan = v_payment.item::text::public.membership_plan,
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

COMMIT;