-- LOCAL THROWAWAY LAB SCHEMA. Not TEST, not PRODUCTION. For offline SQL validation only.
-- Mimics only the objects the storage-deletion lifecycle / fence code touches.
-- The four real migrations (20261017120000..150000) are applied verbatim on top of this.
-- The payments method/UTR constraints from 20261004120000 are embedded below so the
-- lab mirrors the real TEST payments CHECK constraints (source of truth: that migration).

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA auth;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;

CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '')
$$;

CREATE TYPE public.app_role AS ENUM ('admin','client');
CREATE TYPE public.approval_status AS ENUM ('pending','approved','rejected');
CREATE TYPE public.membership_plan AS ENUM ('free','standard','premium');
CREATE TYPE public.payment_status AS ENUM ('submitted','verified','rejected');
CREATE TYPE public.payment_item AS ENUM ('standard','premium','jathagam');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  photo_url text,
  membership_plan public.membership_plan NOT NULL DEFAULT 'free',
  status public.approval_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  doc_type text NOT NULL,
  id_kind text,
  storage_key text NOT NULL,
  file_name text,
  mime_type text,
  size_bytes bigint,
  ai_check_status text,
  ai_check_notes text,
  ai_face_match_score numeric,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item public.payment_item NOT NULL,
  amount_inr integer NOT NULL,
  method text NOT NULL,
  utr_reference text,
  proof_key text,
  gateway_order_id text,
  gateway_payment_id text,
  status public.payment_status NOT NULL DEFAULT 'submitted',
  admin_notes text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Payment-method constraints, taken from the committed migration
-- supabase/migrations/20261004120000_payment_method_utr_constraints.sql.
-- The local lab previously omitted them, which hid the invalid E6 method
-- fixture ('t5') that the real TEST schema rejects with 23514.
ALTER TABLE public.payments
ADD CONSTRAINT payments_method_allowed
CHECK (method IN ('online', 'upi', 'bank_transfer'));

ALTER TABLE public.payments
ADD CONSTRAINT payments_utr_reference_maxlen
CHECK (utr_reference IS NULL OR length(utr_reference) <= 120);

ALTER TABLE public.payments
ADD CONSTRAINT payments_manual_utr_required
CHECK (
  method NOT IN ('upi', 'bank_transfer')
  OR (utr_reference IS NOT NULL AND trim(utr_reference) <> '')
);

CREATE UNIQUE INDEX payments_manual_utr_user_item_uniq
ON public.payments (user_id, item, upper(trim(utr_reference)))
WHERE method IN ('upi', 'bank_transfer')
  AND utr_reference IS NOT NULL;

CREATE UNIQUE INDEX payments_manual_submitted_user_item_uniq
ON public.payments (user_id, item)
WHERE method IN ('upi', 'bank_transfer')
  AND status = 'submitted';

CREATE TABLE public.jathagam_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  birth_date date NOT NULL,
  birth_time text NOT NULL,
  birth_place text NOT NULL,
  notes text,
  report_key text,
  report_file_name text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  subject text NOT NULL DEFAULT 'Support request',
  status text NOT NULL DEFAULT 'open',
  channel text NOT NULL DEFAULT 'support',
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_type text NOT NULL DEFAULT 'member',
  body text NOT NULL,
  attachment_key text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  item public.payment_item NOT NULL,
  amount_inr integer NOT NULL,
  kind text NOT NULL DEFAULT 'PAYMENT_VERIFIED',
  gateway_order_id text,
  gateway_payment_id text,
  verified_at timestamptz NOT NULL,
  processed_at timestamptz,
  receipt_status text NOT NULL DEFAULT 'pending',
  receipt_key text UNIQUE,
  receipt_error text,
  receipt_attempts integer NOT NULL DEFAULT 0,
  receipt_processed_at timestamptz,
  receipt_lease_until timestamptz,
  notification_status text NOT NULL DEFAULT 'pending',
  notification_error text,
  notification_attempts integer NOT NULL DEFAULT 0,
  notification_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON public.payment_events TO authenticated;
