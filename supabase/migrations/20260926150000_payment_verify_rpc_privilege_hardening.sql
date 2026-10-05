-- payment_verify_rpc_privilege_hardening
-- Closes review finding E3 against 20260925130000_payment_b1_atomic.sql, which
-- defines public.verify_payment(text, uuid, text) as SECURITY DEFINER owned by
-- postgres and is the single shared plan-activation primitive for both payment
-- routes.
--
-- FINDING (critical): anon and authenticated can call the verify_payment RPC,
-- which creates a self-service payment/plan activation path.
--
--   20260925130000:157-158 already states the intent, service role only:
--     REVOKE EXECUTE ON FUNCTION public.verify_payment(text, uuid, text) FROM PUBLIC;
--     GRANT  EXECUTE ON FUNCTION public.verify_payment(text, uuid, text) TO service_role;
--
--   That REVOKE FROM PUBLIC is not sufficient on Supabase. The platform default
--   ACL for functions in the public schema grants EXECUTE *directly* to anon,
--   authenticated and service_role, confirmed on the live database:
--     pg_default_acl for objtype 'f' in schema public, owner postgres
--       = {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
--          service_role=X/postgres}
--   Revoking PUBLIC removes only the implicit grant. The direct anon and
--   authenticated entries applied at CREATE time survive, so the deployed ACL
--   read back as:
--     {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
--      service_role=X/postgres}
--   with has_function_privilege true for anon and authenticated. This is why the
--   same revoke pattern used at 20260925150000:220-221, which names the roles
--   explicitly, produced a correct ACL for profiles_client_field_guard.
--
--   The exposure matters because the function is SECURITY DEFINER, so it
--   executes with postgres rights and bypasses the RLS policies on the tables
--   it writes, and because it performs no verification of its own. It never
--   contacts the gateway and never checks a signature. Its only claim predicate
--   is gateway_order_id = p_gateway_order_id AND user_id = p_user_id AND
--   status = 'submitted', and p_user_id is caller supplied and is never
--   compared with auth.uid(). The Razorpay HMAC check lives only in
--   confirmPaymentOrder (src/lib/payments.functions.ts:148-149), in application
--   code, so it can be skipped by not calling that function. The self-service
--   path is: an authenticated member calls createPaymentOrder, which creates a
--   real payment row already in status 'submitted' via the service role and
--   returns orderId to the client with no money moved, then calls
--   POST /rest/v1/rpc/verify_payment directly with that orderId, their own
--   p_user_id and a forged p_gateway_payment_id. The function marks the payment
--   verified and writes membership_plan and plan_valid_until, so membership is
--   activated without payment and without the signature check.
--
--   SECURITY DEFINER is not itself the defect. A definer function is the correct
--   design here, because the atomic transition must bypass RLS. The defect is
--   the combination of definer rights with client-granted EXECUTE, on a
--   function that verifies nothing and trusts a caller supplied p_user_id.
--
-- FIX
--   Re-apply the revoke naming PUBLIC, anon and authenticated explicitly, so
--   all three grant sources are removed, then re-grant service_role.
--
--   This is deliberately privilege-only. The function definition and body are
--   not touched, no other function's privileges are changed, and no payment RLS
--   policy is changed. The only legitimate caller is
--   src/lib/payments.functions.ts:159, which uses supabaseAdmin built from
--   SUPABASE_SERVICE_ROLE_KEY, so it resolves to service_role and is unaffected.
--
--   Deliberately NOT included: ALTER DEFAULT PRIVILEGES to revoke the public
--   schema's function default ACL. Other functions currently rely on it, so
--   that is a broader change with its own regression surface and belongs in a
--   separate, audited migration rather than bundled with this fix.
--
-- ############################################################################
-- # Local validation: test-harness/payment-verify-rpc-privileges.sql          #
-- ############################################################################

REVOKE EXECUTE
ON FUNCTION public.verify_payment(text, uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.verify_payment(text, uuid, text)
TO service_role;
