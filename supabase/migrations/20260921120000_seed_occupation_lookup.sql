-- Occupation options for father/mother occupation dropdowns (member & admin forms).
INSERT INTO public.lookup_options (category, value_en, value_ta) VALUES
('occupation','Agriculture','விவசாயம்'),
('occupation','Business','வணிகம்'),
('occupation','Doctor','மருத்துவர்'),
('occupation','Engineer','பொறியாளர்'),
('occupation','Government Employee','அரசு ஊழியர்'),
('occupation','Teacher','ஆசிரியர்')
ON CONFLICT (category, value_en) DO NOTHING;