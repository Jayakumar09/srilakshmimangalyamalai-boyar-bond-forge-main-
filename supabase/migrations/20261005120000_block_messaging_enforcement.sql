-- block_messaging_enforcement
-- Operation 33: Enforce bidirectional blocks on conversations and messages.
--
-- This migration:
--   1. Adds index for reverse block lookup (target_id, user_id).
--   2. Creates can_message_to(from_user, to_user) which checks approval+plan+bidirectional blocks.
--   3. Updates conversations INSERT policy to enforce blocks both directions.
--   4. Updates messages INSERT policy to enforce blocks both directions on every send.
--
-- Existing can_message(uuid) is preserved unchanged for any other callers.
-- Existing conversations and messages are unaffected (policies only apply to new INSERTs).
-- Admin behavior is preserved (admin policies bypass can_message* checks).
--
-- NOTE: Do not apply until reviewed. Not idempotent.

-- ---------------------------------------------------------------------------
-- 1. Add index for reverse block lookup
--    Existing UNIQUE(user_id, target_id) covers forward lookup.
--    This index covers (target_id, user_id) for "who blocked me" queries.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS blocks_target_user_idx
ON public.blocks (target_id, user_id);

-- ---------------------------------------------------------------------------
-- 2. New function: can_message_to(from_user, to_user)
--    Returns true only if:
--      - from_user is approved with paid plan (standard/premium)
--      - NO block exists in EITHER direction between from_user and to_user
--    STABLE SECURITY DEFINER with fixed search_path for safety.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_message_to(_from_user_id uuid, _to_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_message(_from_user_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.blocks
       WHERE (user_id = _from_user_id AND target_id = _to_user_id)
          OR (user_id = _to_user_id AND target_id = _from_user_id)
     );
$$;

REVOKE EXECUTE ON FUNCTION public.can_message_to(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_message_to(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Update conversations INSERT policy
--    Replace existing policy with bidirectional block check.
--    The policy now calls can_message_to(sender, other_participant).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "paid members start conversations" ON public.conversations;
CREATE POLICY "paid members start conversations" ON public.conversations
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() IN (user_a, user_b)
  AND public.can_message_to(
    auth.uid(),
    CASE WHEN auth.uid() = user_a THEN user_b ELSE user_a END
  )
);

-- ---------------------------------------------------------------------------
-- 4. Update messages INSERT policy
--    Replace existing policy with bidirectional block check on EVERY message send.
--    This ensures a block added AFTER a conversation exists still prevents messages.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "participants send messages" ON public.messages;
CREATE POLICY "participants send messages" ON public.messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND public.can_message_to(
    auth.uid(),
    (SELECT CASE WHEN user_a = auth.uid() THEN user_b ELSE user_a END
     FROM public.conversations WHERE id = conversation_id)
  )
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND auth.uid() IN (c.user_a, c.user_b)
  )
);

-- ---------------------------------------------------------------------------
-- Documentation: can_message_to usage
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.can_message_to(uuid, uuid) IS
'Returns true if from_user can message to_user: requires approved paid plan AND no block in either direction. Used by conversations and messages INSERT RLS policies.';