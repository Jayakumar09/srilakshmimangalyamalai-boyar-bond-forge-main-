-- profile_admin_identity_and_plan_guard
-- Closes two review findings against 20260926120000 (UPDATE self-approval guard)
-- and 20260926130000 (INSERT self-approval guard), which together close the
-- direct self-approval holes but leave two reachable escalations.
--
-- FINDING 1 (critical): the id-swap self-approval bypass.
--
--   Both migrations decide "is this the admin's own row?" by comparing
--   profiles.id with auth.uid(). That is only sound while id is immutable, and
--   it is not. "admins full profiles" is FOR ALL, and the guard's own
--   NEW.id IS DISTINCT FROM v_uid check sits AFTER the v_trusted return, so an
--   admin never reaches it. An admin could therefore:
--     1. UPDATE their own row's id (status unchanged, so the approval guard's
--        status test passes),
--     2. UPDATE that row to 'approved', now with OLD.id <> auth.uid(), so the
--        self-approval predicate is false,
--     3. UPDATE the id back, landing an approved profile on their own id.
--   Reproduced locally against the real trigger set with all three migrations
--   applied: the only triggers on profiles are this guard, the client_profile_id
--   assigner and updated_at, and no foreign key references public.profiles.id,
--   so nothing else rejects the rename. Confirmed against production, which is
--   still on the old 20260925150000 body, so the bypass is open there today.
--
--   Fix: forbid an admin from changing profiles.id on any row. This cannot be
--   keyed on "own row", because own-row detection is exactly what was unsound.
--   Admins have no legitimate need to rewrite a uuid primary key, and blocking
--   it unconditionally also removes the variant where a row approved under
--   another id is renamed onto the admin's own id.
--
-- FINDING 2: admin self-grant of membership_plan / plan_valid_until.
--
--   The approval guards deliberately cover only status, but v_trusted returns
--   NEW for an admin, so the later client branch that pins membership_plan and
--   plan_valid_until to their previous values is skipped for admins too. An
--   admin could write premium/10-years onto their own row with a plain UPDATE.
--   Separately, "own profile insert" requires membership_plan = 'free' AND
--   plan_valid_until IS NULL, but "admins full profiles" is OR'd on top of it,
--   so the admin's own row could be inserted as 'pending' with a premium plan
--   -- the self-approval INSERT branch blocks approved/rejected, not the plan.
--
-- Scope, deliberately minimal:
--   * Own row only for the plan fields, so an admin can still manage every
--     other member's plan exactly as before.
--   * Service role, SECURITY DEFINER callers, handle_new_user() and the
--     verify_payment() RPC are unaffected: they run with a privileged
--     current_user, which the new branches skip before has_role() is reached,
--     exactly as the existing INSERT branch already does. This is what keeps the
--     self-purchase path working -- payments.functions.ts buys a plan through
--     supabaseAdmin.rpc('verify_payment', {p_user_id: context.userId}), i.e.
--     service role, not through a direct profile write.
--   * No policy, grant, table, or unrelated profile behaviour is touched.
--     CREATE OR REPLACE keeps the function OID, owner and ACL, so
--     profiles_00_client_field_guard stays bound and the REVOKE/GRANT from
--     20260925150000 remain in force without being repeated.
--   * The three new blocks run before v_trusted, preserving the invariant that
--     every admin protection precedes the admin bypass.
--
-- Because CREATE OR REPLACE rewrites the entire function, the body below is
-- the 20260926130000 body plus the three blocks marked identity/membership
-- below, and nothing else.
--
-- NOT YET APPLIED to production. Review before running `supabase db push`.

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
  -- Placed before the v_trusted bypass on purpose: v_trusted returns NEW for
  -- admins, so a check placed after it could never protect an admin. Nested in
  -- an explicit TG_OP = 'UPDATE' test rather than an AND chain because SQL
  -- does not guarantee short-circuit evaluation and OLD is only assigned for
  -- UPDATE.
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

  -- >>> admin self-approval guard, INSERT branch (new in this migration) >>>
  -- Same reasoning as the UPDATE branch above, applied to row creation. Without
  -- this, an admin can bypass "own profile insert" simply by satisfying
  -- "admins full profiles", and the v_trusted return below would skip the
  -- guard's own "Clients may only create pending profiles" check.
  --
  -- NEW.id is used rather than OLD.id because OLD is not assigned on INSERT,
  -- and NEW.status is used without a comparison against OLD because there is
  -- no previous row. An admin inserting their own 'pending' row is still
  -- allowed: that is not an approval, and it is what handle_new_user() does.
  --
  -- The privileged-caller test mirrors the first two clauses of v_trusted
  -- below and is required, not optional: this branch runs before v_trusted is
  -- computed, so without it a service_role or SECURITY DEFINER caller that
  -- carries an admin id in its JWT would be blocked, changing service-role
  -- behaviour. current_user cannot be forged by a client, and auth.role() is
  -- 'service_role' only for a holder of the service_role key, so skipping
  -- these callers grants nothing to an attacker: they already bypass the guard
  -- entirely via v_trusted further down.
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
  -- >>> admin identity + membership guard, UPDATE branch (new in this migration) >>>
  IF TG_OP = 'UPDATE' THEN
    -- Identity is the anchor the approval guards above depend on, so it has to
    -- be immutable for the very callers those guards are meant to constrain.
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

  -- Now that id cannot move, own-row detection is sound and the plan fields can
  -- be protected on that basis. Other members stay fully manageable.
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
  -- <<< admin identity + membership guard, UPDATE branch <<<

  -- >>> admin membership-plan guard, INSERT branch (new in this migration) >>>
  -- Mirrors the "own profile insert" RLS predicate (free, no expiry) that the
  -- OR'd "admins full profiles" policy otherwise lets an admin sidestep.
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
  -- <<< admin membership-plan guard, INSERT branch <<<

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