-- profile_admin_self_approval_guard
-- Closes the admin self-approval hole left open by the guard added in
-- 20260925150000_profile_client_field_guard.sql.
--
-- Problem: that guard classifies an admin caller as "trusted" and then returns
-- NEW immediately, BEFORE its own client self-approval check, so that check is
-- unreachable for admins. Combined with the ownership-only "own profile
-- update" policy and the permissive FOR ALL "admins full profiles" policy, an
-- admin could set their own profiles.status to approved/rejected with a direct
-- browser UPDATE and never reach the guard's restrictions at all.
--
-- Fix: re-create the same function with one addition, a self-approval guard
-- that runs BEFORE the v_trusted bypass. Nothing else changes.
--
-- Scope, deliberately minimal:
--   * UPDATE only, so INSERT behaviour is untouched.
--   * A real status transition only, so an admin can still edit their own
--     already-approved or already-rejected profile.
--   * A real admin only, via the project's existing has_role() helper.
--   * No policy, trigger, grant, table, or unrelated profile behaviour is
--     touched. CREATE OR REPLACE keeps the function OID, owner and ACL, so
--     profiles_00_client_field_guard stays bound to it and the REVOKE/GRANT
--     from 20260925150000 remain in force without being repeated.
--
-- Because CREATE OR REPLACE rewrites the entire function, the body below must
-- be kept in sync with 20260925150000 apart from the block marked below.
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
  -- >>> admin self-approval guard (new in this migration) >>>
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
  -- <<< admin self-approval guard (new in this migration) <<<
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
