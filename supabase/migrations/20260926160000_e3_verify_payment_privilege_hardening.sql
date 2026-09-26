-- e3_verify_payment_privilege_hardening
-- E3: Harden verify_payment RPC privileges to close the self-service
-- payment/plan activation path confirmed in review.
--
-- FINDING (critical): The 20260925130000_payment_b1_atomic.sql migration
-- defines public.verify_payment(text, uuid, text) as SECURITY DEFINER owned
-- by postgres. The platform default ACL for functions in the public schema
-- grants EXECUTE directly to anon, authenticated, and service_role at CREATE
-- time. The REVOKE FROM PUBLIC in 20260925130000:157 is not sufficient on
-- Supabase because the direct anon and authenticated entries survive.
--
-- This migration explicitly revokes EXECUTE from PUBLIC, anon, and
-- authenticated, then re-grants only to service_role. The legitimate
-- application caller uses SUPABASE_SERVICE_ROLE_KEY and resolves to
-- service_role, so it is unaffected.
--
-- This is deliberately privilege-only. The function definition and body are
-- not touched, no other function's privileges are changed, and no payment RLS
-- policy is changed.

REVOKE EXECUTE
ON FUNCTION public.verify_payment(text, uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.verify_payment(text, uuid, text)
TO service_role;