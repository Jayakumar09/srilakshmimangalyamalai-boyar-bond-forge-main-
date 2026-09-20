ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_created_by text NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS created_by_admin_id uuid,
  ADD COLUMN IF NOT EXISTS last_updated_by uuid,
  ADD COLUMN IF NOT EXISTS last_updated_by_type text,
  ADD COLUMN IF NOT EXISTS last_updated_at timestamptz;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_profile_created_by_chk CHECK (profile_created_by IN ('client','admin'));

CREATE TABLE public.profile_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  actor_id uuid,
  actor_type text NOT NULL DEFAULT 'admin',
  action text NOT NULL,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.profile_audit TO authenticated;
GRANT ALL ON public.profile_audit TO service_role;
ALTER TABLE public.profile_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins profile audit" ON public.profile_audit FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "owner reads own audit" ON public.profile_audit FOR SELECT TO authenticated
  USING (profile_id = auth.uid());
CREATE INDEX profile_audit_profile_idx ON public.profile_audit(profile_id, created_at DESC);

CREATE TABLE public.support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  subject text NOT NULL DEFAULT 'Support request',
  status text NOT NULL DEFAULT 'open',
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.support_threads TO authenticated;
GRANT ALL ON public.support_threads TO service_role;
ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins support threads" ON public.support_threads FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "own support threads select" ON public.support_threads FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "own support threads insert" ON public.support_threads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "own support threads update" ON public.support_threads FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER support_threads_updated_at BEFORE UPDATE ON public.support_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_type text NOT NULL DEFAULT 'member',
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.support_messages TO authenticated;
GRANT ALL ON public.support_messages TO service_role;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins support messages" ON public.support_messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "own support messages select" ON public.support_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.support_threads s WHERE s.id = thread_id AND s.user_id = auth.uid()));
CREATE POLICY "own support messages insert" ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND sender_type = 'member'
    AND EXISTS (SELECT 1 FROM public.support_threads s WHERE s.id = thread_id AND s.user_id = auth.uid()));
CREATE POLICY "own support messages update" ON public.support_messages FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.support_threads s WHERE s.id = thread_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.support_threads s WHERE s.id = thread_id AND s.user_id = auth.uid()));
CREATE INDEX support_messages_thread_idx ON public.support_messages(thread_id, created_at);