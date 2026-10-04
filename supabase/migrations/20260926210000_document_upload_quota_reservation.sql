-- M61-D11: atomic per-owner quota reservation for profile uploads.
--
-- Why: storage.functions.ts enforced the 6 photo / 5 document / 11 file / 20 MiB
-- caps by reading a snapshot (previously a documents query, now an R2 listing)
-- and then acting on it. Two concurrent uploads for the same owner both read the
-- same stale numbers and both passed, so the caps could be exceeded without
-- bound by simply uploading in parallel. A read cannot be made atomic against a
-- write to R2; only a reservation can.
--
-- How: one counter row per owner, mutated inside a transaction that first takes
-- a per-owner advisory lock (pg_advisory_xact_lock). Every mutation of these
-- counters goes through these functions, so the lock serialises all of them and
-- a reservation either observes the previous reservation or waits for it.
--
-- The counters are seeded exactly once, from the server-measured R2 totals, and
-- afterwards only move through reserve/release/resync. The seed values are NOT
-- client supplied: these functions are service_role only, so the only caller is
-- our own server function, which lists R2 and passes what it measured. A member
-- cannot seed a low value to launder a bypass.
--
-- The limit values and the raised codes are identical to the ones the TypeScript
-- used to throw, so friendlyUploadError() keeps resolving them unchanged.
--
-- NOT YET APPLIED to production. Review before running `supabase db push`.

BEGIN;

CREATE TABLE IF NOT EXISTS public.document_upload_counters (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  photo_count integer NOT NULL DEFAULT 0,
  doc_count integer NOT NULL DEFAULT 0,
  byte_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_upload_counters_nonneg
    CHECK (photo_count >= 0 AND doc_count >= 0 AND byte_count >= 0)
);

ALTER TABLE public.document_upload_counters ENABLE ROW LEVEL SECURITY;

-- No client policy: the table is unreachable from anon/authenticated and is
-- only ever mutated through the SECURITY DEFINER functions below.
REVOKE ALL ON TABLE public.document_upload_counters FROM anon, authenticated;

COMMENT ON TABLE public.document_upload_counters IS
  'Authoritative per-owner upload counters, seeded once from measured R2 usage. Written only via reserve/release/resync; never by clients.';

-- Reserve one upload's worth of quota, or raise the same code the TypeScript
-- used to throw. p_seed_* are only honoured when the counter row is created,
-- i.e. on an owner's first ever reservation.
CREATE OR REPLACE FUNCTION public.reserve_upload_quota(
  p_user_id uuid,
  p_folder text,
  p_size_bytes bigint,
  p_seed_photo integer,
  p_seed_doc integer,
  p_seed_bytes bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_photo integer;
  v_doc integer;
  v_bytes bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_size_bytes IS NULL OR p_size_bytes < 0 THEN
    RAISE EXCEPTION 'Invalid quota reservation.' USING ERRCODE = '22023';
  END IF;

  -- Serialises every counter mutation for this owner. Released at commit, so the
  -- next upload for the same owner observes this reservation.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- ON CONFLICT DO UPDATE returns the existing (unchanged) row; a fresh insert
  -- returns the seeded values. One statement, so no read-then-write window.
  INSERT INTO public.document_upload_counters
    (user_id, photo_count, doc_count, byte_count)
  VALUES (
    p_user_id,
    GREATEST(COALESCE(p_seed_photo, 0), 0),
    GREATEST(COALESCE(p_seed_doc, 0), 0),
    GREATEST(COALESCE(p_seed_bytes, 0), 0)
  )
  ON CONFLICT (user_id) DO UPDATE
    SET updated_at = now()
  RETURNING photo_count, doc_count, byte_count
  INTO v_photo, v_doc, v_bytes;

  -- Same order and same comparisons as the TypeScript checks.
  IF p_folder = 'photo' THEN
    IF v_photo >= 6 THEN
      RAISE EXCEPTION 'UPLOAD_LIMIT_PHOTOS';
    END IF;
  ELSE
    IF v_doc >= 5 THEN
      RAISE EXCEPTION 'UPLOAD_LIMIT_DOCS';
    END IF;
  END IF;

  IF v_photo + v_doc >= 11 THEN
    RAISE EXCEPTION 'UPLOAD_LIMIT_TOTAL';
  END IF;

  IF v_bytes + p_size_bytes > 20971520 THEN
    RAISE EXCEPTION 'UPLOAD_LIMIT_STORAGE';
  END IF;

  UPDATE public.document_upload_counters
     SET photo_count = photo_count + CASE WHEN p_folder = 'photo' THEN 1 ELSE 0 END,
         doc_count = doc_count + CASE WHEN p_folder = 'photo' THEN 0 ELSE 1 END,
         byte_count = byte_count + p_size_bytes,
         updated_at = now()
   WHERE user_id = p_user_id;
END;
$$;

-- Undo a reservation whose upload never completed. Floored at zero so a
-- double release can never manufacture free quota.
CREATE OR REPLACE FUNCTION public.release_upload_quota(
  p_user_id uuid,
  p_folder text,
  p_size_bytes bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_size_bytes IS NULL OR p_size_bytes < 0 THEN
    RAISE EXCEPTION 'Invalid quota release.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  UPDATE public.document_upload_counters
     SET photo_count = GREATEST(photo_count - CASE WHEN p_folder = 'photo' THEN 1 ELSE 0 END, 0),
         doc_count = GREATEST(doc_count - CASE WHEN p_folder = 'photo' THEN 0 ELSE 1 END, 0),
         byte_count = GREATEST(byte_count - p_size_bytes, 0),
         updated_at = now()
   WHERE user_id = p_user_id;
END;
$$;

-- Overwrite the counters from a fresh server-side R2 listing. Used after a
-- delete, where the authoritative truth is what is still in the bucket. This is
-- also self-healing: it repairs any drift accumulated between resyncs.
CREATE OR REPLACE FUNCTION public.resync_upload_quota(
  p_user_id uuid,
  p_photo integer,
  p_doc integer,
  p_bytes bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid quota resync.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  INSERT INTO public.document_upload_counters
    (user_id, photo_count, doc_count, byte_count)
  VALUES (
    p_user_id,
    GREATEST(COALESCE(p_photo, 0), 0),
    GREATEST(COALESCE(p_doc, 0), 0),
    GREATEST(COALESCE(p_bytes, 0), 0)
  )
  ON CONFLICT (user_id) DO UPDATE
    SET photo_count = EXCLUDED.photo_count,
        doc_count = EXCLUDED.doc_count,
        byte_count = EXCLUDED.byte_count,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_upload_quota(uuid, text, bigint, integer, integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_upload_quota(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resync_upload_quota(uuid, integer, integer, bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_upload_quota(uuid, text, bigint, integer, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_upload_quota(uuid, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.resync_upload_quota(uuid, integer, integer, bigint) TO service_role;

COMMIT;