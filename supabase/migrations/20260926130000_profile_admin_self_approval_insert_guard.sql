-- profile_admin_self_approval_insert_guard
-- Closes the INSERT-side admin self-approval hole left open by
-- 20260925150000_profile_client_field_guard.sql, independently of the
-- UPDATE-side fix in 20260926120000_profile_admin_self_approval_guard.sql.
--
-- Problem, confirmed against the live-verified schema and reproduced locally:
--
--   1. RLS. "admins full profiles" is FOR ALL with
--      WITH CHECK (has_role(auth.uid(),'admin')). Permissive policies are OR'd
--      together, so for an admin the WITH CHECK of "own profile insert"
--      (id = auth.uid() AND status = 'pending' AND membership_plan = 'free'
--      AND plan_valid_until IS NULL) is irrelevant: the admin policy already
--      satisfies the INSERT on its own. Nothing in RLS stops an admin from
--      inserting their own row with status = 'approved' or 'rejected'.
--
--   2. Trigger. profiles_client_field_guard() classifies an admin caller as
--      v_trusted and returns NEW immediately, before its own INSERT branch,
--      which is the only code that forces a client row to start 'pending' and
--      'free'. So the guard's own defence is also bypassed for admins.
--
--   3. Reachable. profiles.id is the primary key, but that is not a defence:
--      handle_new_user() creates the row with ON CONFLICT (id) DO NOTHING, and
--      no foreign key references public.profiles. An admin therefore only has
--      to remove their own row first (DELETE is granted to authenticated and
--      allowed by "admins full profiles") and then re-INSERT it as approved.
--      RegisterWizard sends an upsert with onConflict "id", so the same INSERT
--      is reached through the normal registration screen.
--
-- Fix: re-create the same function with one addition, an INSERT branch of the
-- admin self-approval guard, next to the UPDATE branch added in
-- 20260926120000. Nothing else changes.
--
-- Scope, deliberately minimal:
--   * INSERT only, so the existing UPDATE branch and all UPDATE behaviour are
--     untouched.
--   * Own row only (NEW.id = v_uid), so admins can still create other members'
--     profiles exactly as before.
--   * A genuine admin only, via the project's existing has_role() helper.
--   * Only the approval decision is blocked. An admin inserting their own row
--     as 'pending' is still allowed, because that is not an approval and is
--     what handle_new_user() itself does during signup.
--   * Service role, SECURITY DEFINER callers and handle_new_user() are
--     unaffected: they run with auth.uid() IS NULL or a privileged
--     current_user, so has_role() is never reached for them.
--   * No policy, grant, table, or unrelated profile behaviour is touched.
--     CREATE OR REPLACE keeps the function OID, owner and ACL, so
--     profiles_00_client_field_guard stays bound to it and the REVOKE/GRANT
--     from 20260925150000 remain in force without being repeated.
--
-- Because CREATE OR REPLACE rewrites the entire function, the body below is
-- the 20260926120000 body plus the block marked INSERT below, and nothing
-- else. Keep it in sync with 20260926120000 apart from that block.
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
