CREATE TYPE public.app_role AS ENUM ('admin','client');
CREATE TYPE public.approval_status AS ENUM ('pending','approved','rejected');
CREATE TYPE public.membership_plan AS ENUM ('free','standard','premium');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins read roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  gender text,
  date_of_birth date,
  marital_status text,
  sub_caste text,
  gothram text,
  mother_tongue text,
  height_cm integer,
  weight_kg integer,
  phone text,
  whatsapp text,
  address_line text,
  city text,
  native_district text,
  state text,
  pincode text,
  education_level text,
  education_detail text,
  profession text,
  job_detail text,
  annual_income text,
  father_name text,
  father_occupation text,
  mother_name text,
  mother_occupation text,
  siblings text,
  family_type text,
  family_status text,
  family_details text,
  pref_age_min integer,
  pref_age_max integer,
  pref_height_min_cm integer,
  pref_marital_status text,
  pref_sub_caste text,
  pref_education text,
  pref_profession text,
  pref_district text,
  pref_notes text,
  birth_time text,
  birth_place text,
  about text,
  photo_url text,
  membership_plan public.membership_plan NOT NULL DEFAULT 'free',
  plan_valid_until date,
  status public.approval_status NOT NULL DEFAULT 'pending',
  admin_notes text,
  consent_accepted_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "admins full profiles" ON public.profiles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "approved members browse approved" ON public.profiles FOR SELECT TO authenticated USING (
  status = 'approved' AND EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = auth.uid() AND me.status = 'approved')
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name',''))
  ON CONFLICT (id) DO NOTHING;
  IF lower(COALESCE(NEW.email,'')) = 'vijayalakshmi@srilakshmimangalyamalai.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id,'admin') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id,'client') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.lookup_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  value_en text NOT NULL,
  value_ta text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, value_en)
);
GRANT SELECT, INSERT ON public.lookup_options TO authenticated;
GRANT SELECT ON public.lookup_options TO anon;
GRANT ALL ON public.lookup_options TO service_role;
ALTER TABLE public.lookup_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads options" ON public.lookup_options FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "members add options" ON public.lookup_options FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "admins manage options" ON public.lookup_options FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own documents" ON public.documents FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "admins documents" ON public.documents FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.shortlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_id)
);
GRANT SELECT, INSERT, DELETE ON public.shortlists TO authenticated;
GRANT ALL ON public.shortlists TO service_role;
ALTER TABLE public.shortlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shortlists" ON public.shortlists FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_id)
);
GRANT SELECT, INSERT, DELETE ON public.blocks TO authenticated;
GRANT ALL ON public.blocks TO service_role;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own blocks" ON public.blocks FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "admins read blocks" ON public.blocks FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  target_id uuid NOT NULL,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reports" ON public.reports FOR SELECT TO authenticated USING (reporter_id = auth.uid());
CREATE POLICY "create reports" ON public.reports FOR INSERT TO authenticated WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "admins reports" ON public.reports FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.lookup_options (category, value_en, value_ta) VALUES
('sub_caste','Boyar','பொயர்'),
('sub_caste','Valayar','வலையர்'),
('sub_caste','Muthuraja','முத்துராஜா'),
('sub_caste','Vettaikaran','வேட்டைக்காரன்'),
('profession','Engineer','பொறியாளர்'),
('profession','Doctor','மருத்துவர்'),
('profession','Teacher','ஆசிரியர்'),
('profession','Government Employee','அரசு ஊழியர்'),
('profession','Business','வணிகம்'),
('profession','Agriculture','விவசாயம்'),
('native_district','Chennai','சென்னை'),
('native_district','Madurai','மதுரை'),
('native_district','Trichy','திருச்சி'),
('native_district','Coimbatore','கோயம்புத்தூர்'),
('native_district','Salem','சேலம்'),
('native_district','Thanjavur','தஞ்சாவூர்');