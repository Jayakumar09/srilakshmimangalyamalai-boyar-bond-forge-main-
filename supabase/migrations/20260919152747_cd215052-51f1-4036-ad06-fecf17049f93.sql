
CREATE TYPE public.payment_status AS ENUM ('submitted','verified','rejected');
CREATE TYPE public.payment_item AS ENUM ('standard','premium','jathagam');

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item payment_item NOT NULL,
  amount_inr integer NOT NULL,
  method text NOT NULL,
  utr_reference text,
  proof_key text,
  gateway_order_id text,
  gateway_payment_id text,
  status payment_status NOT NULL DEFAULT 'submitted',
  admin_notes text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own payments select" ON public.payments FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own payments insert" ON public.payments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND status = 'submitted');
CREATE POLICY "admins payments" ON public.payments FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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
GRANT SELECT, INSERT ON public.jathagam_requests TO authenticated;
GRANT ALL ON public.jathagam_requests TO service_role;
ALTER TABLE public.jathagam_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own jathagam select" ON public.jathagam_requests FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own jathagam insert" ON public.jathagam_requests FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "admins jathagam" ON public.jathagam_requests FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER jathagam_updated_at BEFORE UPDATE ON public.jathagam_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.can_message(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND p.status = 'approved'
      AND p.membership_plan IN ('standard','premium')
  )
$$;
REVOKE EXECUTE ON FUNCTION public.can_message(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_message(uuid) TO authenticated;

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a uuid NOT NULL,
  user_b uuid NOT NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_pair_order CHECK (user_a < user_b),
  CONSTRAINT conversations_pair_unique UNIQUE (user_a, user_b)
);
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants read conversations" ON public.conversations FOR SELECT TO authenticated USING (auth.uid() IN (user_a, user_b));
CREATE POLICY "paid members start conversations" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IN (user_a, user_b) AND public.can_message(auth.uid()));
CREATE POLICY "participants touch conversations" ON public.conversations FOR UPDATE TO authenticated
  USING (auth.uid() IN (user_a, user_b)) WITH CHECK (auth.uid() IN (user_a, user_b));
CREATE POLICY "admins conversations" ON public.conversations FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON public.messages (conversation_id, created_at);
GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants read messages" ON public.messages FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND auth.uid() IN (c.user_a, c.user_b))
);
CREATE POLICY "participants send messages" ON public.messages FOR INSERT TO authenticated WITH CHECK (
  sender_id = auth.uid()
  AND public.can_message(auth.uid())
  AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND auth.uid() IN (c.user_a, c.user_b))
);
CREATE POLICY "participants update messages" ON public.messages FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND auth.uid() IN (c.user_a, c.user_b))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND auth.uid() IN (c.user_a, c.user_b))
);
CREATE POLICY "admins messages" ON public.messages FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  email_to text NOT NULL,
  related_user_id uuid,
  emailed boolean NOT NULL DEFAULT false,
  email_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins notifications" ON public.notifications FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
