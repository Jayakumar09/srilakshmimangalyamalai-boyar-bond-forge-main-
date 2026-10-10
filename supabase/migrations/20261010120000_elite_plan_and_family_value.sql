-- elite_plan_and_family_value
-- Matrimony plan pricing update:
--   Standard  ₹2,000 -> ₹3,000
--   Premium   ₹5,000 (unchanged)
--   Elite     NEW  ₹10,000, available to families whose stated family value is
--             above ₹10 crore
--   Jathagam  ₹500 (unchanged)
--
-- The prices themselves live in the app code (src/lib/payments.functions.ts
-- PRICES) and are stored per payment at submit time, so nothing here rewrites
-- historical payments. This migration prepares the database side of Elite:
--
--   1. payment_item and membership_plan enums gain the 'elite' value.
--   2. profiles.family_value column (stated family value bucket) + CHECK.
--   3. profiles_client_field_guard allow-list gains family_value. The
--      replacement body below is the FINAL 20260926140000 body (admin
--      self-approval + identity + membership-plan guard fixes) plus the new
--      field, because 20260926120000/1300/1400 are NOT YET applied to
--      production and this file must be self-contained.
--   4. verify_payment activates membership_plan for elite payments too.
--   5. can_message() (used by can_message_to and the messaging policies)
--      recognises elite as a paid, messaging-eligible plan.
--
-- PostgreSQL caveat: enums added with ALTER TYPE ... ADD VALUE cannot be
-- referenced inside the same transaction that adds them, so every statement
-- that uses the 'elite' label lives in its own transaction below.
--
-- PREPARED ONLY — NOT APPLIED. Do not run until reviewed. No backfill runs;
-- existing payment rows and stored amounts are left untouched.

-- ---------------------------------------------------------------------------
-- Transaction 1: enum values (no 'elite' references elsewhere in this txn).
-- ---------------------------------------------------------------------------
BEGIN;

ALTER TYPE public.payment_item
  ADD VALUE IF NOT EXISTS 'elite';

ALTER TYPE public.membership_plan
  ADD VALUE IF NOT EXISTS 'elite';

COMMIT;

-- ---------------------------------------------------------------------------
-- Transaction 2: profiles.family_value column + constraint.
-- ---------------------------------------------------------------------------
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS family_value text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_family_value_chk;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_family_value_chk
  CHECK (family_value IS NULL OR family_value IN ('below_5cr', '5_10cr', 'above_10cr'));

COMMENT ON COLUMN public.profiles.family_value IS
'Stated family value bucket (below_5cr, 5_10cr, above_10cr). The Elite plan (₹10,000) is available to families whose stated family value is above_10cr (above ₹10 crore).';

COMMIT;

-- ---------------------------------------------------------------------------
-- Transaction 3: profiles_client_field_guard allow-list gains family_value.
-- Body is the 20260926140000 final body + the new column.
-- CREATE OR REPLACE preserves the function OID, ACL and trigger binding, so
-- the REVOKE/GRANT and trigger statements from 20260925150000 remain in force.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.profiles_client_field_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_trusted boolean;
  v_changed text[];
  v_allowed_fields text[] := ARRAY[
    'about',
    'address_line',
    'admin_notes',
    'annual_income',
    'birth_place',
    'birth_time',
    'brothers',
    'caste',
    'city',
    'client_profile_id',
    'consent_accepted_at',
    'created_at',
    'created_by_admin_id',
    'date_of_birth',
    'education_detail',
    'education_level',
    'email',
    'family_details',
    'family_status',
    'family_type',
    'family_value',
    'father_name',
    'father_occupation',
    'full_name',
    'gender',
    'gothram',
    'height_cm',
    'id',
    'job_detail',
    'last_updated_at',
    'last_updated_by',
    'last_updated_by_type',
    'marital_status',
    'membership_plan',
    'mother_name',
    'mother_occupation',
    'mother_tongue',
    'native_district',
    'phone',
    'photo_url',
    'pincode',
    'plan_valid_until',
    'pref_age_max',
    'pref_age_min',
    'pref_district',
    'pref_education',
    'pref_height_min_cm',
    'pref_marital_status',
    'pref_notes',
    'pref_profession',
    'pref_sub_caste',
    'profession',
    'profile_created_by',
    'sisters',
    'siblings',
    'state',
    'status',
    'sub_caste',
    'submitted_at',
    'updated_at',
    'weight_kg',
    'whatsapp'
  ]::text[];
BEGIN
  v_uid := auth.uid();

  -- >>> admin self-approval guard, UPDATE branch (from 20260926120000) >>>
  IF TG_OP = 'UPDATE' THEN
    IF v_uid IS NOT NULL
       AND public.has_role(v_uid, 'admin'::public.app_role)
       AND OLD.id = v_uid
       AND NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status IN ('approved'::public.approval_status,
                          'rejected'::public.approval_status) THEN
      RAISE EXCEPTION 'Admins cannot approve or reject their own profile'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  -- <<< admin self-approval guard, UPDATE branch <<<

  -- >>> admin self-approval guard, INSERT branch (from 20260926130000) >>>
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL
       AND NOT (
              current_user IN ('postgres', 'service_role', 'supabase_admin')
           OR auth.role() = 'service_role'
            )
       AND public.has_role(v_uid, 'admin'::public.app_role)
       AND NEW.id = v_uid
       AND NEW.status IN ('approved'::public.approval_status,
                          'rejected'::public.approval_status) THEN
      RAISE EXCEPTION 'Admins cannot approve or reject their own profile'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  -- <<< admin self-approval guard, INSERT branch <<<

  -- >>> admin identity + membership guard (from 20260926140000) >>>
  IF TG_OP = 'UPDATE' THEN
    IF v_uid IS NOT NULL
       AND NOT (
              current_user IN ('postgres', 'service_role', 'supabase_admin')
           OR auth.role() = 'service_role'
            )
       AND public.has_role(v_uid, 'admin'::public.app_role)
       AND NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Admins cannot change a profile id'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF v_uid IS NOT NULL
       AND NOT (
              current_user IN ('postgres', 'service_role', 'supabase_admin')
           OR auth.role() = 'service_role'
            )
       AND public.has_role(v_uid, 'admin'::public.app_role)
       AND OLD.id = v_uid
       AND (
             NEW.membership_plan IS DISTINCT FROM OLD.membership_plan
          OR NEW.plan_valid_until IS DISTINCT FROM OLD.plan_valid_until
            ) THEN
      RAISE EXCEPTION 'Admins cannot change their own membership plan'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL
       AND NOT (
              current_user IN ('postgres', 'service_role', 'supabase_admin')
           OR auth.role() = 'service_role'
            )
       AND public.has_role(v_uid, 'admin'::public.app_role)
       AND NEW.id = v_uid
       AND (
             NEW.membership_plan IS DISTINCT FROM 'free'::public.membership_plan
          OR NEW.plan_valid_until IS NOT NULL
            ) THEN
      RAISE EXCEPTION 'Admins cannot set their own membership plan'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  -- <<< admin identity + membership guard <<<

  v_trusted :=
       current_user IN ('postgres', 'service_role', 'supabase_admin')
    OR auth.role() = 'service_role'
    OR (
      v_uid IS NOT NULL
      AND public.has_role(v_uid, 'admin'::public.app_role)
    );

  IF v_trusted THEN
    RETURN NEW;
  END IF;

  IF v_uid IS NULL
     OR (current_user <> 'authenticated' AND auth.role() <> 'authenticated') THEN
    RAISE EXCEPTION 'Profile changes are not permitted for this role'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'A client may only change its own profile'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(n.key ORDER BY n.key)
      INTO v_changed
      FROM jsonb_each(to_jsonb(NEW)) AS n
     WHERE n.key <> ALL (v_allowed_fields);

    IF v_changed IS NOT NULL THEN
      RAISE EXCEPTION 'Unknown client profile fields: %',
        array_to_string(v_changed, ', ')
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status IS NULL
       OR NEW.status IS DISTINCT FROM 'pending'::public.approval_status THEN
      RAISE EXCEPTION 'Clients may only create pending profiles'
        USING ERRCODE = '42501';
    END IF;

    NEW.status := 'pending'::public.approval_status;
    NEW.email := auth.email();
    NEW.membership_plan := 'free'::public.membership_plan;
    NEW.plan_valid_until := NULL;
    NEW.admin_notes := NULL;
    NEW.profile_created_by := 'client';
    NEW.created_by_admin_id := NULL;
    NEW.siblings := NULL;
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.last_updated_by := v_uid;
    NEW.last_updated_by_type := 'client';
    NEW.last_updated_at := now();

    IF NEW.consent_accepted_at IS NOT NULL THEN
      NEW.consent_accepted_at := now();
    END IF;

    IF NEW.submitted_at IS NOT NULL THEN
      IF NEW.consent_accepted_at IS NULL THEN
        RAISE EXCEPTION 'Consent is required before profile submission'
          USING ERRCODE = '42501';
      END IF;

      NEW.submitted_at := now();
    END IF;

    RETURN NEW;
  END IF;

  SELECT array_agg(n.key ORDER BY n.key)
    INTO v_changed
    FROM jsonb_each(to_jsonb(NEW)) AS n
   WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key)
     AND n.key <> ALL (v_allowed_fields);

  IF v_changed IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown client profile fields: %',
      array_to_string(v_changed, ', ')
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS NULL THEN
    RAISE EXCEPTION 'Approval status cannot be null'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IS DISTINCT FROM 'pending'::public.approval_status THEN
    RAISE EXCEPTION 'Clients cannot approve or reject their own profile'
      USING ERRCODE = '42501';
  END IF;

  NEW.status := CASE
    WHEN NEW.status IS DISTINCT FROM OLD.status
     AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     AND NEW.submitted_at IS NOT NULL
     AND NEW.consent_accepted_at IS NOT NULL
      THEN 'pending'::public.approval_status
    ELSE OLD.status
  END;

  IF NEW.consent_accepted_at IS DISTINCT FROM OLD.consent_accepted_at THEN
    IF NEW.consent_accepted_at IS NULL THEN
      NEW.consent_accepted_at := OLD.consent_accepted_at;
    ELSE
      NEW.consent_accepted_at := now();
    END IF;
  END IF;

  IF NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    IF NEW.submitted_at IS NULL THEN
      NEW.submitted_at := OLD.submitted_at;
    ELSIF NEW.status <> 'pending'::public.approval_status
       OR NEW.consent_accepted_at IS NULL THEN
      RAISE EXCEPTION 'A valid pending submission requires consent'
        USING ERRCODE = '42501';
    ELSE
      NEW.submitted_at := now();
    END IF;
  END IF;

  NEW.id := v_uid;
  NEW.email := COALESCE(auth.email(), OLD.email);
  NEW.membership_plan := OLD.membership_plan;
  NEW.plan_valid_until := OLD.plan_valid_until;
  NEW.admin_notes := OLD.admin_notes;
  NEW.profile_created_by := OLD.profile_created_by;
  NEW.created_by_admin_id := OLD.created_by_admin_id;
  NEW.siblings := OLD.siblings;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  NEW.last_updated_by := v_uid;
  NEW.last_updated_by_type := 'client';
  NEW.last_updated_at := now();

  RETURN NEW;
END;
$$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Transaction 4: verify_payment activates membership for elite too.
-- Body is the 20260926170000 final body with the plan guard extended.
-- CREATE OR REPLACE preserves the ACL from 20260926150000/1600
-- (service_role only; revoked from PUBLIC/anon/authenticated).
-- ---------------------------------------------------------------------------
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

  UPDATE public.payments
     SET status = 'verified',
         gateway_payment_id = p_gateway_payment_id,
         verified_at = now()
   WHERE gateway_order_id = p_gateway_order_id
     AND user_id = p_user_id
     AND status = 'submitted'
   RETURNING * INTO v_payment;

  IF v_payment.id IS NULL THEN
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

  IF v_payment.item IN ('standard', 'premium', 'elite') THEN
    v_valid_until := (now() + interval '1 year')::date;
    UPDATE public.profiles
       SET membership_plan = v_payment.item::text::public.membership_plan,
           plan_valid_until = v_valid_until
     WHERE id = p_user_id;
  END IF;

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

  INSERT INTO public.payment_events
    (payment_id, user_id, item, amount_inr, kind, gateway_order_id, gateway_payment_id, verified_at)
  VALUES
    (v_payment.id, p_user_id, v_payment.item, v_payment.amount_inr,
     'PAYMENT_VERIFIED', v_payment.gateway_order_id, p_gateway_payment_id, v_payment.verified_at);

  RETURN QUERY SELECT v_payment.id, v_payment.item, v_payment.amount_inr, true, false;
END;
$$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Transaction 5: can_message() recognises elite as a paid plan.
-- can_message_to() and the conversations/messages INSERT policies call this
-- function, so no further change is needed there.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.can_message(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND p.status = 'approved'
      AND p.membership_plan IN ('standard','premium','elite')
  )
$$;

REVOKE EXECUTE ON FUNCTION public.can_message(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_message(uuid) TO authenticated;

COMMIT;