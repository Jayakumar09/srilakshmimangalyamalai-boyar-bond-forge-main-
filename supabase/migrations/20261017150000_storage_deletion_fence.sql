-- Finding 5: durable, per-key deletion fence that stops a reference being
-- created between the deletion worker's last reference check and the R2 DELETE.
-- LOCAL ONLY: applying this migration requires separate approval.
-- Depends on Finding 2 (20261017120000), Finding 3 (20261017130000) and
-- Finding 4 (20261017140000).
--
-- THE RACE (pre-Finding-5). request_storage_deletion and the worker's re-check
-- both read a snapshot of the six reference sources. A reference INSERT/UPDATE
-- that commits AFTER the worker's read but BEFORE the R2 DELETE therefore
-- survives the deletion: R2 drops the object and the database keeps a row that
-- points at nothing. Holding the read in the same transaction as the external
-- R2 DELETE is not an option (a network call must never sit inside a database
-- transaction).
--
-- THE FENCE. A per-key row in public.storage_deletion_fences is the durable
-- authorization to delete. It is written ONLY by fence_storage_key_for_deletion,
-- in the same transaction and under the same per-key advisory lock that the
-- reference-write triggers take, and ONLY after an authoritative re-check of all
-- six sources while that lock is held. Because the lock serialises the two, a
-- reference committed before the fence is seen by the re-check (the request is
-- blocked, the fence is never written) and a reference attempted after the fence
-- is rejected by the trigger. The R2 DELETE happens only in a LATER transaction,
-- after the fence row is durably committed.
--
-- Reference writers are interrupted at the database level (BEFORE INSERT OR
-- UPDATE OF <key> triggers on all six tables), so ordinary clients, admins and
-- service_role are all covered; RLS, column privileges or an RPC bypass cannot
-- evade it.
--
-- The fence is NEVER removed by a lease expiry, an R2 failure, a retry or a
-- successful finalization. Once the object is confirmed absent any later
-- reference would be dangling, so the tombstone is permanent. The key is always
-- server-generated with a v4 UUID (see uploadFile), so a permanent tombstone
-- cannot block a legitimate re-upload of the same literal key.
BEGIN;

-- ---------------------------------------------------------------------------
-- The fence itself.
-- ---------------------------------------------------------------------------
-- No foreign key to storage_deletion_requests on purpose: the tombstone must
-- outlive every state change of the request (including a future pruning) and
-- must stay authoritative on its own. request_id is provenance only.
CREATE TABLE public.storage_deletion_fences (
  storage_key text PRIMARY KEY,
  request_id uuid,
  fenced_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.storage_deletion_fences ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: this table is read and written only by the
-- SECURITY DEFINER fence/trigger functions below. Supabase default privileges
-- grant anon/authenticated ALL on new public tables (including TRUNCATE, which
-- RLS never filters), so those defaults are revoked explicitly rather than
-- relied on implicitly. PUBLIC is revoked defensively, service_role keeps its
-- own grant, and the definer-owned functions are unaffected by this REVOKE.
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.storage_deletion_fences
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.storage_deletion_fences TO service_role;

-- ---------------------------------------------------------------------------
-- Reference-write guard. Rejects any INSERT/UPDATE that would create a literal
-- reference to a fenced key, for every role.
-- ---------------------------------------------------------------------------
-- The referenced column is named by the trigger argument (TG_ARGV[0]) so one
-- function serves all six tables. Only the literal value is considered: keys are
-- validated upstream and Findings 2-3 use exact-match semantics too, so a
-- noncanonical or legacy value can never equal a canonical (validated) deletion
-- key and needs no special handling. Fail closed if the trigger is ever created
-- without its argument.
CREATE FUNCTION public.enforce_storage_key_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
  v_column text := TG_ARGV[0];
  v_key text;
BEGIN
  IF v_column IS NULL OR v_column = '' THEN
    RAISE EXCEPTION 'Storage fence trigger is misconfigured.' USING ERRCODE = 'XX000';
  END IF;

  v_key := to_jsonb(NEW) ->> v_column;
  IF v_key IS NULL THEN
    -- No reference on this row (column is NULL / cleared): nothing to fence.
    RETURN NEW;
  END IF;

  -- Same per-key transaction lock as fence_storage_key_for_deletion. If the
  -- fence transaction got here first, this statement's snapshot is taken AFTER
  -- the wait (VOLATILE function, read committed), so the committed fence below
  -- is seen and the write is rejected. If this writer got here first, it holds
  -- the lock until it commits, and the fence's own re-check then sees the row.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));

  IF EXISTS (
    SELECT 1 FROM public.storage_deletion_fences AS f
     WHERE f.storage_key = v_key
  ) THEN
    RAISE EXCEPTION 'Storage key is fenced for deletion.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- One before-row guard per reference source. `UPDATE OF <col>` keeps the check
-- off writes that never touch the reference column. The `_50_` prefix sorts
-- after the existing `_00_` client guards; none of those rewrite the key column,
-- so the order is immaterial but the name documents the intent.
CREATE TRIGGER documents_50_storage_key_fence
  BEFORE INSERT OR UPDATE OF storage_key ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_storage_key_fence('storage_key');

CREATE TRIGGER payments_50_proof_key_fence
  BEFORE INSERT OR UPDATE OF proof_key ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_storage_key_fence('proof_key');

CREATE TRIGGER jathagam_requests_50_report_key_fence
  BEFORE INSERT OR UPDATE OF report_key ON public.jathagam_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_storage_key_fence('report_key');

CREATE TRIGGER support_messages_50_attachment_key_fence
  BEFORE INSERT OR UPDATE OF attachment_key ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_storage_key_fence('attachment_key');

CREATE TRIGGER profiles_50_photo_url_fence
  BEFORE INSERT OR UPDATE OF photo_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_storage_key_fence('photo_url');

CREATE TRIGGER payment_events_50_receipt_key_fence
  BEFORE INSERT OR UPDATE OF receipt_key ON public.payment_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_storage_key_fence('receipt_key');

-- ---------------------------------------------------------------------------
-- Fence establishment (service-role only). Called by the deletion worker in the
-- transaction BEFORE it performs the R2 DELETE; its commit is what authorizes
-- the delete.
-- ---------------------------------------------------------------------------
-- Returns:
--   'fenced'                      -> fence committed (or already present); the
--                                    caller may now perform the R2 DELETE.
--   'blocked_protected_reference' -> a payment/report/attachment/photo/receipt
--                                    still references the key; not fenced.
--   'blocked_document_set_changed'-> a document row references the key that was
--                                    not captured at request time; not fenced.
--   'not_claimed'                 -> the request is not live or the lease is
--                                    stale; the caller must not touch R2.
CREATE FUNCTION public.fence_storage_key_for_deletion(
  p_request_id uuid,
  p_lease_token uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
  v_key text;
  v_ids uuid[];
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT r.storage_key, r.document_row_ids
    INTO v_key, v_ids
    FROM public.storage_deletion_requests AS r
   WHERE r.id = p_request_id
     AND r.lease_token = p_lease_token
     AND r.lease_expires_at > now()
     AND r.status IN ('pending', 'deleting', 'blocked', 'finalizing');

  IF NOT FOUND THEN
    RETURN 'not_claimed';
  END IF;

  -- Serialise fence establishment against every reference writer for this key
  -- (the triggers) and against other deletion workers. Transaction-scoped; the
  -- R2 DELETE happens later, outside any transaction.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));

  -- A committed fence is authoritative and permanent. Re-checking it would only
  -- re-read the state the fence already guarantees (no reference can have been
  -- added since), so a retry after a lease expiry, an R2 failure, a crash or a
  -- confirmed-absent finalization retry reuses it directly.
  IF EXISTS (
    SELECT 1 FROM public.storage_deletion_fences AS f
     WHERE f.storage_key = v_key
  ) THEN
    RETURN 'fenced';
  END IF;

  -- Authoritative re-check of all six reference sources, under the per-key lock.
  -- Kept literal (mirrors check_storage_deletion_references) so it is guaranteed
  -- to read freshly committed rows immediately after acquiring the lock rather
  -- than the snapshot of an enclosing statement.
  IF EXISTS (SELECT 1 FROM public.payments AS p WHERE p.proof_key = v_key)
     OR EXISTS (SELECT 1 FROM public.jathagam_requests AS j WHERE j.report_key = v_key)
     OR EXISTS (SELECT 1 FROM public.support_messages AS m WHERE m.attachment_key = v_key)
     OR EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.photo_url = v_key)
     OR EXISTS (SELECT 1 FROM public.payment_events AS e WHERE e.receipt_key = v_key)
  THEN
    RETURN 'blocked_protected_reference';
  END IF;

  -- Any document row with this key that was NOT captured at request time is a
  -- newly inserted reference: never fence (and so never delete the object) out
  -- from under it. Captured rows are the request's own rows and are removed at
  -- finalization; rows already removed are simply absent.
  IF EXISTS (
    SELECT 1 FROM public.documents AS d
     WHERE d.storage_key = v_key
       AND NOT (d.id = ANY (v_ids))
  ) THEN
    RETURN 'blocked_document_set_changed';
  END IF;

  INSERT INTO public.storage_deletion_fences (storage_key, request_id)
  VALUES (v_key, p_request_id)
  ON CONFLICT (storage_key) DO NOTHING;

  RETURN 'fenced';
END;
$$;

-- ---------------------------------------------------------------------------
-- Object-creation safety net (service-role only).
-- ---------------------------------------------------------------------------
-- uploadFile already generates a fresh `${owner}/${folder}/${Date.now()}-<uuid-
-- v4>-<name>` key on every call, so a PUT can never target a fenced literal key
-- in practice. This probe lets the upload path refuse anyway, closing the gap
-- should a caller ever supply, or a bug ever reuse, an existing key.
CREATE FUNCTION public.is_storage_key_fenced(p_storage_key text)
RETURNS boolean
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

  RETURN EXISTS (
    SELECT 1 FROM public.storage_deletion_fences AS f
     WHERE f.storage_key = p_storage_key
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Ownership + visibility hardening.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.enforce_storage_key_fence()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fence_storage_key_for_deletion(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_storage_key_fenced(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Trigger functions are invoked by the DML, not directly; the grant follows the
-- existing `_00_` guards so an operator can run the function by hand if needed.
GRANT EXECUTE ON FUNCTION public.enforce_storage_key_fence()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fence_storage_key_for_deletion(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.is_storage_key_fenced(text)
  TO service_role;

COMMIT;
