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

REVOKE ALL ON FUNCTION public.profiles_client_field_guard()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.profiles_client_field_guard()
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS profiles_00_client_field_guard ON public.profiles;

CREATE TRIGGER profiles_00_client_field_guard
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.profiles_client_field_guard();

-- Row ownership only. Trusted-field protection (status, membership_plan,
-- plan_valid_until, admin_notes, profile_created_by, created_by_admin_id) is
-- enforced by profiles_client_field_guard(). The correlated subqueries used
-- here before resolved to p.id = p.id, which raised a cardinality error for
-- any member able to see more than one profiles row.
DROP POLICY IF EXISTS "own profile update" ON public.profiles;

CREATE POLICY "own profile update"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

COMMIT;
