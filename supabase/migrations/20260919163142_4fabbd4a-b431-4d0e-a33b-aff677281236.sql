CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id AND p.status = 'approved'
  )
$$;

DROP POLICY IF EXISTS "approved members browse approved" ON public.profiles;

CREATE POLICY "approved members browse approved"
ON public.profiles
FOR SELECT
TO authenticated
USING (status = 'approved' AND public.is_approved(auth.uid()));