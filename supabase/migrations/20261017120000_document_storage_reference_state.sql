-- Finding 2: authoritative, read-only document reference verification.
-- LOCAL ONLY: applying this migration requires separate approval.
-- These snapshots do not prevent references inserted before a later R2 DELETE.
BEGIN;

CREATE FUNCTION public.get_document_storage_reference_state(p_storage_key text)
RETURNS TABLE (has_references boolean, may_delete_references boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_admin boolean;
BEGIN
  IF v_actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  -- Match Phase 1's literal ASCII key contract. Never decode or normalize.
  IF p_storage_key IS NULL
     OR length(p_storage_key) NOT BETWEEN 1 AND 300
     OR p_storage_key COLLATE "C" ~ '[^A-Za-z0-9._/-]'
     OR strpos(p_storage_key, '/') = 0
     OR EXISTS (
       SELECT 1 FROM unnest(string_to_array(p_storage_key, '/')) AS s(segment)
       WHERE s.segment IN ('', '.', '..')
     ) THEN
    RAISE EXCEPTION 'Invalid storage key.' USING ERRCODE = '22023';
  END IF;

  v_admin := public.has_role(v_actor, 'admin'::public.app_role);
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Cannot verify authorization.' USING ERRCODE = '42501';
  END IF;
  IF split_part(p_storage_key, '/', 1) <> v_actor::text AND v_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    EXISTS (SELECT 1 FROM public.documents AS d WHERE d.storage_key = p_storage_key),
    v_admin OR NOT EXISTS (
      SELECT 1 FROM public.documents AS d
      WHERE d.storage_key = p_storage_key AND d.user_id IS DISTINCT FROM v_actor
    );
END;
$$;

ALTER FUNCTION public.get_document_storage_reference_state(text) OWNER TO postgres;

-- row_security=off does NOT grant bypass. Verify the chosen trusted owner can
-- actually see every document; abort the whole migration if it cannot.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS r
    JOIN pg_catalog.pg_class AS c ON c.oid = 'public.documents'::regclass
    WHERE r.rolname = 'postgres'
      AND (r.rolsuper OR r.rolbypassrls OR (c.relowner = r.oid AND NOT c.relforcerowsecurity))
      AND pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT')
  ) THEN
    RAISE EXCEPTION 'Reference RPC owner lacks authoritative document visibility';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_document_storage_reference_state(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_document_storage_reference_state(text) TO authenticated;

COMMIT;
