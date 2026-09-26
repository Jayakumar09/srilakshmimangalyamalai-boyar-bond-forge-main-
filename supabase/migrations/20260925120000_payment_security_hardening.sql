-- payment_security_hardening
-- Closes the payment-verification gaps found in the checkout inspection.
--
-- NOTE: This migration is APPLIED to production (project
-- sxpkutjkqfekqwpabgrk; verified 2026-09-26) and is part of the intended end
-- state. Do not re-apply: it is not idempotent.

-- ---------------------------------------------------------------------------
-- F1: Clients must not be able to directly modify payment-controlled profile
-- fields (membership_plan, plan_valid_until, status).
--
-- Own-row UPDATE stays available for normal profile editing, but the fields
-- above are now frozen for the client role:
--   * membership_plan and plan_valid_until must equal the stored values, so
--     only the admin policy (has_role) or the service role used by the
--     server-side verification functions may change them.
--   * status may only be set to 'pending' (registration / resubmission) or to
--     the stored value, so a client can never approve or reject themselves.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "own profile update" ON public.profiles;
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND membership_plan = (SELECT p.membership_plan FROM public.profiles p WHERE p.id = id)
    AND coalesce(plan_valid_until, DATE '1970-01-01')
        IS NOT DISTINCT FROM coalesce((SELECT p.plan_valid_until FROM public.profiles p WHERE p.id = id), DATE '1970-01-01')
    AND (
      status = (SELECT p.status FROM public.profiles p WHERE p.id = id)
      OR status = 'pending'
    )
  );

-- F1 (defense in depth): any profile row a client creates must only ever start
-- as a free, pending draft. The handle_new_user trigger already creates rows
-- with these exact defaults via SECURITY DEFINER, so this never conflicts with
-- signup.
DROP POLICY IF EXISTS "own profile insert" ON public.profiles;
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid()
    AND membership_plan = 'free'
    AND plan_valid_until IS NULL
    AND status = 'pending'
  );

-- ---------------------------------------------------------------------------
-- F2: Clients cannot INSERT payment rows at all. Every payment row is now
-- created by a server function -- createPaymentOrder for gateway orders and
-- submitManualPayment for manual UTR submissions -- using the trusted service
-- role, so amount_inr / method / status can never be invented by the browser.
-- Clients keep SELECT (their own rows, via the "own payments select" policy)
-- and admins keep the admin ALL policy for verification updates.
-- ---------------------------------------------------------------------------
REVOKE INSERT ON public.payments FROM authenticated;
DROP POLICY IF EXISTS "own payments insert" ON public.payments;

-- ---------------------------------------------------------------------------
-- F3: A Jathagam request may only reference one of the requester's OWN payment
-- rows, never another member's payment. payment_id IS NULL stays allowed for
-- the gateway flow where the payment row is linked server-side and the request
-- is created after verification.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "own jathagam insert" ON public.jathagam_requests;
CREATE POLICY "own jathagam insert" ON public.jathagam_requests FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      payment_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.id = payment_id AND p.user_id = auth.uid()
      )
    )
  );