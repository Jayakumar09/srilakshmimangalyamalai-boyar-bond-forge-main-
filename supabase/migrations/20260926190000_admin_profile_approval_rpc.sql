-- admin_profile_approval_rpc
-- Adds a server-side SECURITY DEFINER RPC for admin profile approval/rejection.
-- Closes the security gap where the browser could directly UPDATE profiles
-- without server-side authorization, pending-state protection, or audit trail.
--
-- This function:
--   1. Verifies the caller is an authenticated admin
--   2. Prevents admin self-approval/self-rejection
--   3. Atomically updates the profile ONLY if status = 'pending'
--   4. Records the decision in profile_audit in the same transaction
--   5. Returns a clear result: success / already_processed / not_found / forbidden / self_approval_blocked
--
-- The existing client-side decideProfile() in src/lib/admin-data.ts should be
-- updated to call this RPC instead of performing a direct UPDATE.

CREATE OR REPLACE FUNCTION public.decide_profile_approval(
  p_profile_id uuid,
  p_status public.approval_status,
  p_rejection_reason text DEFAULT NULL
)
RETURNS TABLE (
  profile_id uuid,
  old_status public.approval_status,
  new_status public.approval_status,
  already_processed boolean,
  error_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_old_status public.approval_status;
  v_is_admin boolean;
BEGIN
  -- 1. Verify the caller is an authenticated admin
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::public.approval_status, NULL::public.approval_status, false, 'unauthenticated';
    RETURN;
  END IF;

  SELECT public.has_role(v_actor_id, 'admin'::public.app_role) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN QUERY SELECT NULL::uuid, NULL::public.approval_status, NULL::public.approval_status, false, 'forbidden';
    RETURN;
  END IF;

  -- 2. Prevent admin self-approval/self-rejection
  -- This check is required because the SECURITY DEFINER function runs as postgres,
  -- which would bypass the profiles_client_field_guard trigger's self-approval check
  -- (that trigger returns early for current_user = 'postgres').
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_profile_id
      AND id = v_actor_id
  ) THEN
    RETURN QUERY SELECT p_profile_id, NULL::public.approval_status, NULL::public.approval_status, false, 'self_approval_blocked';
    RETURN;
  END IF;

  -- 3. Validate requested status is only approved or rejected
  IF p_status NOT IN ('approved'::public.approval_status, 'rejected'::public.approval_status) THEN
    RAISE EXCEPTION 'Invalid status for profile approval: %', p_status
      USING ERRCODE = '22023';
  END IF;

  -- 4. Atomically update the profile ONLY if currently pending
  -- Capture old status before update
  SELECT status INTO v_old_status FROM public.profiles WHERE id = p_profile_id;
  
  UPDATE public.profiles
     SET status = p_status,
         admin_notes = p_rejection_reason,
         last_updated_by = v_actor_id,
         last_updated_by_type = 'admin',
         last_updated_at = now()
   WHERE id = p_profile_id
     AND status = 'pending'::public.approval_status;

  -- Check if UPDATE affected any row
  IF NOT FOUND THEN
    -- Distinguish: profile not found vs. profile not pending
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
      -- Profile exists but not pending (already approved/rejected)
      SELECT status INTO v_old_status FROM public.profiles WHERE id = p_profile_id;
      RETURN QUERY SELECT p_profile_id, v_old_status, p_status, true, 'already_processed';
    ELSE
      -- Profile not found
      RETURN QUERY SELECT NULL::uuid, NULL::public.approval_status, NULL::public.approval_status, false, 'not_found';
    END IF;
    RETURN;
  END IF;

  -- 5. Record audit trail in the same transaction
  INSERT INTO public.profile_audit (
    profile_id,
    actor_id,
    actor_type,
    action,
    details
  ) VALUES (
    p_profile_id,
    v_actor_id,
    'admin',
    CASE
      WHEN p_status = 'approved'::public.approval_status THEN 'profile_approved'
      ELSE 'profile_rejected'
    END,
    CASE
      WHEN p_status = 'approved'::public.approval_status
      THEN format('Admin approved profile. Previous status: %s', v_old_status)
      ELSE format('Admin rejected profile. Previous status: %s. Reason: %s', v_old_status, COALESCE(p_rejection_reason, '(none)'))
    END
  );

  -- 6. Return success
  RETURN QUERY SELECT p_profile_id, v_old_status, p_status, false, NULL;
END;
$$;

-- Explicitly revoke from PUBLIC, anon, authenticated
-- The function will be called via the authenticated Supabase client from the browser
-- Authorization is enforced inside the function via has_role()
-- This pattern matches the reviewPayment server function approach

REVOKE EXECUTE ON FUNCTION public.decide_profile_approval(uuid, public.approval_status, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decide_profile_approval(uuid, public.approval_status, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.decide_profile_approval(uuid, public.approval_status, text) FROM authenticated;

-- Grant to authenticated so browser admins can call it
-- The function itself enforces admin role check
GRANT EXECUTE ON FUNCTION public.decide_profile_approval(uuid, public.approval_status, text) TO authenticated;

-- Grant to service_role for server-side callers
GRANT EXECUTE ON FUNCTION public.decide_profile_approval(uuid, public.approval_status, text) TO service_role;