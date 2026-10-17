-- Finding 3: protect every known literal R2 reference, including receipts.
-- LOCAL ONLY: application requires separate approval. Requires Finding 2 and
-- the support-attachment/payment-receipt schema migrations.
-- Read snapshots do not prevent new references before a later R2 DELETE.
BEGIN;

CREATE FUNCTION public.get_storage_reference_state(p_storage_key text)
RETURNS TABLE (
  has_document_references boolean,
  may_delete_document_references boolean,
  has_protected_references boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
  v_documents boolean;
  v_may_delete boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  -- Reuse Finding 2's canonical literal-key validation, auth.uid()-derived
  -- owner/admin authorization and authoritative document permissions FIRST.
  -- STRICT rejects zero/multiple rows; null/inconsistent state also fails closed.
  SELECT s.has_references, s.may_delete_references
    INTO STRICT v_documents, v_may_delete
    FROM public.get_document_storage_reference_state(p_storage_key) AS s;
  IF v_documents IS NULL OR v_may_delete IS NULL
     OR (NOT v_documents AND NOT v_may_delete) THEN
    RAISE EXCEPTION 'Cannot verify document references.' USING ERRCODE = '22023';
  END IF;

  -- All statuses, owners and folders count. These references are never detached
  -- by generic deletion, including for admins. Return no identifying row data.
  RETURN QUERY SELECT v_documents, v_may_delete,
    EXISTS (SELECT 1 FROM public.payments AS p WHERE p.proof_key = p_storage_key)
    OR EXISTS (SELECT 1 FROM public.jathagam_requests AS j WHERE j.report_key = p_storage_key)
    OR EXISTS (SELECT 1 FROM public.support_messages AS m WHERE m.attachment_key = p_storage_key)
    OR EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.photo_url = p_storage_key)
    OR EXISTS (SELECT 1 FROM public.payment_events AS e WHERE e.receipt_key = p_storage_key);
END;
$$;

ALTER FUNCTION public.get_storage_reference_state(text) OWNER TO postgres;

-- row_security=off alone is NOT bypass permission. Check effective unfiltered
-- SELECT for the trusted owner on EVERY table, not merely one matching table.
-- Missing relations fail at regclass resolution; no table is silently skipped.
DO $$
DECLARE
  v_table regclass;
BEGIN
  FOR v_table IN SELECT unnest(ARRAY[
    'public.documents'::regclass,
    'public.payments'::regclass,
    'public.jathagam_requests'::regclass,
    'public.support_messages'::regclass,
    'public.profiles'::regclass,
    'public.payment_events'::regclass
  ]) LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS r
      JOIN pg_catalog.pg_class AS c ON c.oid = v_table
      WHERE r.rolname = 'postgres'
        AND (r.rolsuper OR r.rolbypassrls OR (c.relowner = r.oid AND NOT c.relforcerowsecurity))
        AND pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT')
    ) THEN
      RAISE EXCEPTION 'Storage reference RPC owner lacks authoritative visibility on %', v_table;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_storage_reference_state(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_storage_reference_state(text) TO authenticated;

COMMIT;
