-- admin_delete_blocks
-- Operation 37: Add admin DELETE policy on blocks for unblock functionality.
--
-- Allows admins to delete any block row (unblock on behalf of users).
-- Matches existing admin patterns on reports/conversations (ALL with has_role).
-- Preserves existing client DELETE (own blocks) and SELECT/INSERT policies.
-- Does not affect Operation 33 messaging enforcement.
--
-- NOTE: Do not apply until reviewed. Idempotent for re-apply safety.

CREATE POLICY "admins delete blocks" ON public.blocks
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));