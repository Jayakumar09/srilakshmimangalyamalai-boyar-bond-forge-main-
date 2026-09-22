-- Gothram (sub-caste) and mother tongue dropdown options (member & admin forms).
-- "Other" is a UX choice in the dropdown; it is not stored as a lookup row.
INSERT INTO public.lookup_options (category, value_en, value_ta) VALUES
('gothram','Eecham Kulam','ஈச்சம் குலம்'),
('gothram','Dhandu Kulam','தண்டு குலம்'),
('gothram','Karumbu Kulam','கரும்பு குலம்'),
('gothram','Mudda Kulam','முட்ட குலம்'),
('gothram','Uppu Kulam','உப்பு குலம்'),
('gothram','Vembu Kulam','வேம்பு குலம்'),
('mother_tongue','Tamil','தமிழ்'),
('mother_tongue','English','ஆங்கிலம்'),
('mother_tongue','Telugu','தெலுங்கு'),
('mother_tongue','Kannada','கன்னடம்'),
('mother_tongue','Hindi','இந்தி')
ON CONFLICT (category, value_en) DO NOTHING;