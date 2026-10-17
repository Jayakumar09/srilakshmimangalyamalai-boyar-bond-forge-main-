-- Finding 4: durable, retryable storage deletion with confirmed-R2-before-metadata
-- ordering. LOCAL ONLY: applying this migration requires separate approval.
-- Depends on Finding 2 (20261017120000) and Finding 3 (20261017130000).
--
-- Snapshots and leases do NOT prevent a reference being inserted between the
-- last reference check and the R2 DELETE. That concurrency race is Finding 5,
-- not solved here. This migration only guarantees that document metadata is
-- never removed before R2 confirms the object is absent, that a failed or
-- uncertain R2 outcome leaves a durable retry record, and that finalization is
-- idempotent and lease-guarded. A request key that has just FAILED also cools
-- down for 15 minutes so repeated recreation cannot reset the retry budget;
-- cancellation is exempt and the window is time-bounded (no permanent lockout).
BEGIN;

-- ---------------------------------------------------------------------------
-- Durable deletion intent / retry state.
-- ---------------------------------------------------------------------------
CREATE TABLE public.storage_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL,
  owner_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  requested_as_admin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  r2_state text NOT NULL DEFAULT 'not_attempted',
  finalize_state text NOT NULL DEFAULT 'pending',
  block_reason text,
  last_error text,
  attempt_count integer NOT NULL DEFAULT 0,
  document_row_ids uuid[] NOT NULL DEFAULT '{}',
  lease_token uuid,
  lease_expires_at timestamptz,
  quota_resynced_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storage_deletion_requests_status_check CHECK (
    status IN ('pending', 'deleting', 'blocked', 'finalizing', 'deleted', 'failed', 'cancelled')
  ),
  CONSTRAINT storage_deletion_requests_r2_state_check CHECK (
    r2_state IN ('not_attempted', 'uncertain', 'confirmed_absent')
  ),
  CONSTRAINT storage_deletion_requests_finalize_state_check CHECK (
    finalize_state IN ('pending', 'done')
  ),
  CONSTRAINT storage_deletion_requests_attempt_check CHECK (attempt_count >= 0),
  CONSTRAINT storage_deletion_requests_lease_check CHECK (
    lease_expires_at IS NULL OR lease_token IS NOT NULL
  ),
  -- Owner is always the key prefix; a caller can never assert a different one.
  CONSTRAINT storage_deletion_requests_owner_prefix_check CHECK (
    split_part(storage_key, '/', 1) = owner_id::text
  ),
  -- Metadata can never be finalized before R2 is confirmed absent.
  CONSTRAINT storage_deletion_requests_finalize_requires_r2_check CHECK (
    finalize_state = 'pending' OR r2_state = 'confirmed_absent'
  ),
  CONSTRAINT storage_deletion_requests_deleted_state_check CHECK (
    status <> 'deleted' OR (r2_state = 'confirmed_absent' AND finalize_state = 'done')
  )
);

-- At most one live request per key. Terminal states (deleted/failed/cancelled)
-- are excluded so a fresh request can be created after one completes.
CREATE UNIQUE INDEX storage_deletion_requests_live_key
  ON public.storage_deletion_requests (storage_key)
  WHERE status IN ('pending', 'deleting', 'blocked', 'finalizing');

CREATE INDEX storage_deletion_requests_claim_idx
  ON public.storage_deletion_requests (status, lease_expires_at);

-- Supports the failed-request cooldown lookup on the request-creation path.
-- Failed rows are terminal and never pruned, so without this the lookup would
-- degrade to a growing sequential scan.
CREATE INDEX storage_deletion_requests_failed_key_idx
  ON public.storage_deletion_requests (storage_key, updated_at)
  WHERE status = 'failed';

ALTER TABLE public.storage_deletion_requests ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: clients have no direct access. Every read/write
-- goes through a SECURITY DEFINER RPC below with its own authorization gate.
-- Supabase default privileges grant anon/authenticated ALL on new public tables,
-- which includes TRUNCATE, REFERENCES and TRIGGER. RLS never filters TRUNCATE,
-- so those defaults must be revoked explicitly rather than relied on implicitly.
-- PUBLIC is revoked defensively. service_role keeps its own grants, and the
-- definer-owned RPCs above/below are unaffected by this table-level REVOKE.
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.storage_deletion_requests
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.storage_deletion_requests TO service_role;

-- ---------------------------------------------------------------------------
-- Authorized deletion-request creation (authenticated caller).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.request_storage_deletion(p_storage_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_admin boolean;
  v_state record;
  v_owner uuid;
  v_ids uuid[];
  v_id uuid;
BEGIN
  IF v_actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  -- Reuse Findings 2-3 canonical-key validation, owner/admin authorization and
  -- authoritative six-table reference state FIRST. Missing/malformed state is
  -- rejected by the callee, so this fails closed.
  SELECT s.has_document_references, s.may_delete_document_references, s.has_protected_references
    INTO STRICT v_state
    FROM public.get_storage_reference_state(p_storage_key) AS s;

  IF v_state.has_protected_references IS TRUE THEN
    RAISE EXCEPTION 'File is still in use and cannot be deleted.' USING ERRCODE = '22023';
  END IF;
  IF v_state.may_delete_document_references IS NOT TRUE THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF split_part(p_storage_key, '/', 1) !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'Invalid storage key.' USING ERRCODE = '22023';
  END IF;
  v_owner := split_part(p_storage_key, '/', 1)::uuid;
  v_admin := public.has_role(v_actor, 'admin'::public.app_role);

  -- Serialize request creation for this key against concurrent callers AND the
  -- service-role failure transition: record_storage_deletion_failure takes the
  -- same per-key lock before it flips a row to 'failed'. Without a shared lock
  -- the cooldown read below could race a just-committed 'failed' row -- the
  -- live-key unique index does not cover terminal rows -- and let a fresh
  -- request reset the retry budget. Transaction-scoped, released at RPC end.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_storage_key, 0));

  -- 15-minute cooldown after a FAILED request for the same key. Cancelled
  -- requests are deliberately exempt, and the window is time-bounded, so this
  -- can never be a permanent lockout: once updated_at is older than 15 minutes a
  -- new request is allowed, still subject to every check above.
  IF EXISTS (
    SELECT 1
      FROM public.storage_deletion_requests AS r
     WHERE r.storage_key = p_storage_key
       AND r.status = 'failed'
       AND r.updated_at > now() - interval '15 minutes'
  ) THEN
    RAISE EXCEPTION 'A recent deletion attempt for this file failed. Please try again later.'
      USING ERRCODE = '22023';
  END IF;

  -- Capture exactly the document rows that are authorized for deletion NOW.
  -- Finalization later deletes only these ids, never a row that appeared after.
  SELECT COALESCE(array_agg(d.id ORDER BY d.id), '{}')
    INTO v_ids
    FROM public.documents AS d
   WHERE d.storage_key = p_storage_key;

  INSERT INTO public.storage_deletion_requests
    (storage_key, owner_id, requested_by, requested_as_admin, document_row_ids)
  VALUES (p_storage_key, v_owner, v_actor, COALESCE(v_admin, false), v_ids)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  -- Idempotent: an existing live request for the key is reused, never duplicated.
  IF v_id IS NULL THEN
    SELECT r.id
      INTO v_id
      FROM public.storage_deletion_requests AS r
     WHERE r.storage_key = p_storage_key
       AND r.status IN ('pending', 'deleting', 'blocked', 'finalizing')
     ORDER BY r.created_at DESC
     LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Cannot create deletion request.' USING ERRCODE = '22023';
  END IF;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Authoritative reference re-check for service-role workers.
--
-- The Findings 2-3 RPCs deliberately reject service_role, so the worker needs
-- its own read-only check. The predicate list MUST stay identical to Finding 3;
-- the offline SQL contract suite pins both lists to prevent drift.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.check_storage_deletion_references(p_storage_key text)
RETURNS TABLE (has_protected_references boolean, current_document_ids uuid[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    EXISTS (SELECT 1 FROM public.payments AS p WHERE p.proof_key = p_storage_key)
    OR EXISTS (SELECT 1 FROM public.jathagam_requests AS j WHERE j.report_key = p_storage_key)
    OR EXISTS (SELECT 1 FROM public.support_messages AS m WHERE m.attachment_key = p_storage_key)
    OR EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.photo_url = p_storage_key)
    OR EXISTS (SELECT 1 FROM public.payment_events AS e WHERE e.receipt_key = p_storage_key),
    (SELECT COALESCE(array_agg(d.id ORDER BY d.id), '{}')
       FROM public.documents AS d
      WHERE d.storage_key = p_storage_key);
END;
$$;

-- ---------------------------------------------------------------------------
-- Lease-based claiming. A claim is CAS on lease_token + expiry; only one
-- worker can hold a request at a time. An expired lease is reclaimable so a
-- crashed worker never strands a request.
--
-- Blocked requests back off for one hour on the database server's clock: a row
-- whose status is 'blocked' is only reclaimable once updated_at is older than an
-- hour. For a blocked row the ONLY writer of updated_at is block_storage_deletion
-- itself -- blocked rows hold no lease and are never touched by the failure,
-- confirm, finalize or quota paths -- so updated_at is that row's blocked-at
-- time and no dedicated blocked_at column is needed. Non-blocked rows keep their
-- existing lease/expiry behaviour, the retry path still performs a fresh
-- authoritative reference check, and the six-reference predicate list is
-- unchanged. This adds no protection against Finding 5: a reference inserted
-- between the last reference check and the R2 DELETE is still not prevented.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.claim_storage_deletion_request(p_request_id uuid)
RETURNS TABLE (
  id uuid,
  storage_key text,
  owner_id uuid,
  lease_token uuid,
  status text,
  r2_state text,
  finalize_state text,
  document_row_ids uuid[],
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    UPDATE public.storage_deletion_requests AS r
       SET lease_token = v_token,
           lease_expires_at = now() + interval '5 minutes',
           status = CASE WHEN r.r2_state = 'confirmed_absent' THEN 'finalizing' ELSE 'deleting' END,
           attempt_count = CASE
             WHEN r.r2_state = 'confirmed_absent' THEN r.attempt_count
             ELSE r.attempt_count + 1
           END,
           block_reason = NULL,
           updated_at = now()
     WHERE r.id = p_request_id
       AND r.status IN ('pending', 'deleting', 'blocked', 'finalizing')
       AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now())
       AND (r.status <> 'blocked' OR r.updated_at < now() - interval '1 hour')
    RETURNING r.*
  )
  SELECT c.id, c.storage_key, c.owner_id, c.lease_token, c.status, c.r2_state,
         c.finalize_state, c.document_row_ids, c.attempt_count
    FROM claimed AS c;
END;
$$;

CREATE FUNCTION public.claim_storage_deletion_requests(p_limit integer)
RETURNS TABLE (
  id uuid,
  storage_key text,
  owner_id uuid,
  lease_token uuid,
  status text,
  r2_state text,
  finalize_state text,
  document_row_ids uuid[],
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    UPDATE public.storage_deletion_requests AS r
       SET lease_token = v_token,
           lease_expires_at = now() + interval '5 minutes',
           status = CASE WHEN r.r2_state = 'confirmed_absent' THEN 'finalizing' ELSE 'deleting' END,
           attempt_count = CASE
             WHEN r.r2_state = 'confirmed_absent' THEN r.attempt_count
             ELSE r.attempt_count + 1
           END,
           block_reason = NULL,
           updated_at = now()
     WHERE r.id IN (
       SELECT c.id
         FROM public.storage_deletion_requests AS c
        WHERE c.status IN ('pending', 'deleting', 'blocked', 'finalizing')
          AND (c.lease_expires_at IS NULL OR c.lease_expires_at < now())
          AND (c.status <> 'blocked' OR c.updated_at < now() - interval '1 hour')
        ORDER BY c.created_at
        LIMIT GREATEST(p_limit, 0)
        FOR UPDATE SKIP LOCKED
     )
    RETURNING r.*
  )
  SELECT c.id, c.storage_key, c.owner_id, c.lease_token, c.status, c.r2_state,
         c.finalize_state, c.document_row_ids, c.attempt_count
    FROM claimed AS c;
END;
$$;

-- ---------------------------------------------------------------------------
-- State transitions. Every one is CAS on the live lease so a stale worker can
-- never overwrite a newer worker's state.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.block_storage_deletion(
  p_request_id uuid,
  p_lease_token uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.storage_deletion_requests AS r
     SET status = 'blocked',
         block_reason = left(p_reason, 200),
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = now()
   WHERE r.id = p_request_id
     AND r.lease_token = p_lease_token
     AND r.lease_expires_at > now()
     AND r.r2_state <> 'confirmed_absent';

  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.record_storage_deletion_failure(
  p_request_id uuid,
  p_lease_token uuid,
  p_error text,
  p_max_attempts integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
  v_status text;
  v_key text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  -- Take the same per-key transaction lock as request_storage_deletion BEFORE
  -- flipping the row to 'failed'. This closes the terminal-state race: a caller
  -- either observes the committed 'failed' row (and is cooled down) or its
  -- INSERT conflicts with the still-live row and is reused idempotently; it can
  -- never insert a fresh request in the instant this transition commits.
  SELECT r.storage_key INTO v_key
    FROM public.storage_deletion_requests AS r
   WHERE r.id = p_request_id;
  IF v_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));
  END IF;

  UPDATE public.storage_deletion_requests AS r
     SET r2_state = 'uncertain',
         status = CASE
           WHEN r.attempt_count >= GREATEST(p_max_attempts, 1) THEN 'failed'
           ELSE 'pending'
         END,
         last_error = left(p_error, 500),
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = now()
   WHERE r.id = p_request_id
     AND r.lease_token = p_lease_token
     AND r.lease_expires_at > now()
     AND r.r2_state <> 'confirmed_absent';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT r.status INTO v_status
    FROM public.storage_deletion_requests AS r
   WHERE r.id = p_request_id;
  RETURN v_status;
END;
$$;

CREATE FUNCTION public.set_r2_confirmed_absent(
  p_request_id uuid,
  p_lease_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.storage_deletion_requests AS r
     SET r2_state = 'confirmed_absent',
         status = 'finalizing',
         last_error = NULL,
         updated_at = now()
   WHERE r.id = p_request_id
     AND r.lease_token = p_lease_token
     AND r.lease_expires_at > now()
     AND r.finalize_state = 'pending';

  RETURN FOUND;
END;
$$;

-- Transactional metadata finalization: delete ONLY the captured ids that still
-- reference the key, verify none survived, then mark done. Delete + verification
-- + state change commit atomically, so neither "documents removed but not marked
-- done" nor "marked done while a captured row survives" can happen.
CREATE FUNCTION public.finalize_storage_deletion(
  p_request_id uuid,
  p_lease_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
  v_ids uuid[];
  v_key text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT r.document_row_ids, r.storage_key
    INTO v_ids, v_key
    FROM public.storage_deletion_requests AS r
   WHERE r.id = p_request_id
     AND r.lease_token = p_lease_token
     AND r.lease_expires_at > now()
     AND r.r2_state = 'confirmed_absent'
     AND r.finalize_state = 'pending'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  DELETE FROM public.documents AS d
   WHERE d.id = ANY(v_ids)
     AND d.storage_key = v_key;

  -- Fail closed: if any originally captured row that STILL references the key
  -- survived the DELETE (e.g. a BEFORE DELETE trigger returned NULL, a DO
  -- INSTEAD rule fired, or the definer owner lost effective DELETE / RLS became
  -- forced after this migration was applied), abort the whole finalization
  -- transaction so the request is never marked deleted/done and can be retried.
  -- This is an existence check, NOT a strict deleted-row count: captured rows
  -- legitimately removed by an earlier attempt are acceptable (EXISTS is false).
  IF EXISTS (
    SELECT 1 FROM public.documents AS d
     WHERE d.id = ANY(v_ids)
       AND d.storage_key = v_key
  ) THEN
    RAISE EXCEPTION 'Storage deletion could not remove captured document rows for %', v_key
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.storage_deletion_requests
     SET finalize_state = 'done',
         status = 'deleted',
         finalized_at = now(),
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = now()
   WHERE id = p_request_id;

  RETURN true;
END;
$$;

CREATE FUNCTION public.mark_storage_deletion_quota_resynced(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.storage_deletion_requests AS r
     SET quota_resynced_at = now(),
         updated_at = now()
   WHERE r.id = p_request_id
     AND r.status = 'deleted'
     AND r.quota_resynced_at IS NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Recovery listing for completed deletions whose quota re-stamp never ran.
--
-- finalize_storage_deletion and the quota re-stamp are separate calls, so a
-- crash, timeout or lost response between them leaves a `deleted` request with
-- quota_resynced_at IS NULL. The claim filters only ever select non-terminal
-- rows, so without this listing the counters would stay high forever. This is a
-- READ-ONLY listing: it returns identity columns only and performs no INSERT,
-- UPDATE or DELETE, so a recovery pass can never remove an R2 object or a
-- document row. Completion is recorded separately with the idempotent
-- mark_storage_deletion_quota_resynced, and only after the re-measure succeeds.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.list_storage_deletion_quota_resyncs(p_limit integer)
RETURNS TABLE (
  id uuid,
  storage_key text,
  owner_id uuid,
  finalized_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT r.id, r.storage_key, r.owner_id, r.finalized_at
      FROM public.storage_deletion_requests AS r
     WHERE r.status = 'deleted'
       AND r.finalize_state = 'done'
       AND r.r2_state = 'confirmed_absent'
       AND r.quota_resynced_at IS NULL
     ORDER BY r.finalized_at NULLS LAST, r.id
     LIMIT GREATEST(p_limit, 0);
END;
$$;

-- Cancellation is only safe before any R2 attempt could have been dispatched.
CREATE FUNCTION public.cancel_storage_deletion(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.storage_deletion_requests AS r
     SET status = 'cancelled',
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = now()
   WHERE r.id = p_request_id
     AND r.status = 'pending'
     AND r.r2_state = 'not_attempted'
     AND r.finalize_state = 'pending'
     AND r.attempt_count = 0
     AND (r.requested_by = v_actor OR public.has_role(v_actor, 'admin'::public.app_role) IS TRUE);

  RETURN FOUND;
END;
$$;

-- ---------------------------------------------------------------------------
-- Ownership + visibility hardening.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.request_storage_deletion(text) OWNER TO postgres;
ALTER FUNCTION public.check_storage_deletion_references(text) OWNER TO postgres;
ALTER FUNCTION public.claim_storage_deletion_request(uuid) OWNER TO postgres;
ALTER FUNCTION public.claim_storage_deletion_requests(integer) OWNER TO postgres;
ALTER FUNCTION public.block_storage_deletion(uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.record_storage_deletion_failure(uuid, uuid, text, integer) OWNER TO postgres;
ALTER FUNCTION public.set_r2_confirmed_absent(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.finalize_storage_deletion(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.mark_storage_deletion_quota_resynced(uuid) OWNER TO postgres;
ALTER FUNCTION public.list_storage_deletion_quota_resyncs(integer) OWNER TO postgres;
ALTER FUNCTION public.cancel_storage_deletion(uuid) OWNER TO postgres;

-- row_security=off alone is NOT bypass permission. Verify the trusted owner can
-- actually see every table the lifecycle reads, and can DELETE from the table
-- finalization mutates. Missing relations fail at regclass resolution; no table
-- is silently skipped.
DO $$
DECLARE
  v_table regclass;
BEGIN
  FOR v_table IN SELECT unnest(ARRAY[
    'public.documents'::regclass,
    'public.storage_deletion_requests'::regclass,
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
      RAISE EXCEPTION 'Storage deletion RPC owner lacks authoritative visibility on %', v_table;
    END IF;
  END LOOP;

  -- Finalization DELETEs the captured document rows. SELECT visibility alone is
  -- not enough: an owner without effective DELETE (or with RLS still enforced on
  -- public.documents) would delete nothing yet still mark the request 'deleted'
  -- and report success, leaking document metadata. Fail the migration closed
  -- here instead of discovering it at runtime. Same trusted-owner / RLS-bypass
  -- predicate as the visibility loop above.
  v_table := 'public.documents'::regclass;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS r
    JOIN pg_catalog.pg_class AS c ON c.oid = v_table
    WHERE r.rolname = 'postgres'
      AND (r.rolsuper OR r.rolbypassrls OR (c.relowner = r.oid AND NOT c.relforcerowsecurity))
      AND pg_catalog.has_table_privilege(r.oid, c.oid, 'DELETE')
  ) THEN
    RAISE EXCEPTION 'Storage deletion RPC owner lacks effective DELETE on %', v_table;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.request_storage_deletion(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.check_storage_deletion_references(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_storage_deletion_request(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_storage_deletion_requests(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.block_storage_deletion(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_storage_deletion_failure(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_r2_confirmed_absent(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_storage_deletion(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_storage_deletion_quota_resynced(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_storage_deletion_quota_resyncs(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_storage_deletion(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.request_storage_deletion(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_storage_deletion(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.check_storage_deletion_references(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_storage_deletion_request(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_storage_deletion_requests(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.block_storage_deletion(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_storage_deletion_failure(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_r2_confirmed_absent(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_storage_deletion(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_storage_deletion_quota_resynced(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_storage_deletion_quota_resyncs(integer) TO service_role;

COMMIT;
