-- document_client_verification_guard
-- Closes audit finding #61 / M61-D1: client-forgeable document verification
-- and AI review state on public.documents.
--
-- FINDING. The baseline migration grants table-level UPDATE to authenticated
-- (20260919142903 line 144) and "own documents" is FOR ALL USING/WITH CHECK
-- user_id = auth.uid() (line 147). RLS restricts *which row* a client may
-- touch, never *which columns*, so a member could set any of
--     public.documents.verified
--     public.documents.ai_check_status
--     public.documents.ai_check_notes
--     public.documents.ai_face_match_score
-- on their own row, and admin verification/approval surfaces read exactly
-- those four columns. Reproduced locally against this schema: four UPDATEs and
-- one INSERT all succeeded and the row came back verified=true / pass.
--
-- The INSERT path is part of the same finding, not a separate one. Column
-- level privileges would not have closed it: INSERT is granted independently,
-- and PostgreSQL cannot revoke a column privilege that the role still holds at
-- table level, so closing the write side by GRANT/REVOKE alone would have meant
-- dismantling the table-level UPDATE grant and re-granting it per column. A
-- trigger closes both operations in one place.
--
-- MECHANISM. A BEFORE INSERT OR UPDATE row guard, built on the mechanism this
-- project already uses for the identical class of defect on public.profiles
-- (profiles_client_field_guard, 20260925150000, hardened by 20260926120000 /
-- 20260926130000 / 20260926140000). Same SECURITY INVOKER shape, same
-- trusted-actor expression, same function ACL, same DROP TRIGGER IF EXISTS +
-- CREATE TRIGGER for idempotency, same 42501 error code. Nothing about the
-- table, its grants, its policies or its ownership model is touched.
--
-- TRUSTED ACTORS (RETURN NEW unchanged) -- unchanged behaviour:
--   * service_role, postgres, supabase_admin, or auth.role() = 'service_role'.
--     current_user cannot be forged by a client and auth.role() is
--     'service_role' only for a holder of the service_role key.
--   * any admin per the project's own public.has_role(). "admins documents" is
--     FOR ALL, so admins keep full read and write on all four columns, which is
--     what the admin verification surfaces need.
--
-- EVERYONE ELSE, i.e. an ordinary authenticated member:
--   * INSERT -- the four columns must already hold their neutral defaults
--     (verified = false, the three AI columns NULL). Explicitly sending
--     verified = false is fine, so the existing client upload paths in
--     DashboardPage.tsx, RegisterWizard.tsx, CreateClientProfileDialog.tsx and
--     ProfileReviewDialog.tsx are unaffected. A forged value is rejected.
--   * UPDATE -- an actual change to any of the four columns is rejected. The
--     test is on the resulting value, not on whether the column was named, so
--     a write that restates the current value is not an error and no unrelated
--     document field becomes unwritable.
--
-- DELIBERATELY NOT CHANGED:
--   * No policy is dropped or rewritten. "own documents" and "admins documents"
--     keep deciding row visibility and ownership exactly as before, so
--     deleteUpload() (src/lib/storage.functions.ts, DELETE) and the per-member
--     document count/byte quota read are untouched.
--   * No document field is revoked. There is no application path that UPDATEs
--     public.documents at all today -- admin-data.ts only ever selects from it,
--     storage.functions.ts only selects and deletes, and verify.functions.ts
--     returns the AI result to the browser without persisting it. So this guard
--     removes no existing capability.
--   * The four columns stay selectable, so the mobile gallery and the admin
--     review dialog keep rendering verification state unchanged.
--   * M61-D2 .. M61-D14 are out of scope and untouched.
--
-- NOT YET APPLIED to production. Review before running `supabase db push`.
--
-- Regression test: test-harness/document-client-verification-guard.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.documents_client_field_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_trusted boolean;
  v_forged text[];
  v_protected text[] := ARRAY[
    'ai_check_notes',
    'ai_check_status',
    'ai_face_match_score',
    'verified'
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
    RAISE EXCEPTION 'Document changes are not permitted for this role'
      USING ERRCODE = '42501';
  END IF;

  -- Nothing is forged on INSERT unless the value differs from the neutral
  -- default, so the column defaults apply to a client that simply omits them.
  IF TG_OP = 'INSERT' THEN
    IF NEW.verified IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Only an administrator can set document verification state'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.ai_check_status IS NOT NULL
       OR NEW.ai_check_notes IS NOT NULL
       OR NEW.ai_face_match_score IS NOT NULL THEN
      RAISE EXCEPTION 'Only the verification service can set document AI review fields'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  -- Compared as resulting values rather than as named columns, so an UPDATE
  -- that leaves a protected column where it already is is not an error and
  -- every other document column stays writable by its owner.
  SELECT array_agg(n.key ORDER BY n.key)
    INTO v_forged
    FROM jsonb_each(to_jsonb(NEW)) AS n
   WHERE n.key = ANY (v_protected)
     AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);

  IF v_forged IS NOT NULL THEN
    RAISE EXCEPTION 'Clients cannot change document verification fields: %',
      array_to_string(v_forged, ', ')
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.documents_client_field_guard()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.documents_client_field_guard()
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS documents_00_client_field_guard ON public.documents;

CREATE TRIGGER documents_00_client_field_guard
BEFORE INSERT OR UPDATE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.documents_client_field_guard();

COMMIT;