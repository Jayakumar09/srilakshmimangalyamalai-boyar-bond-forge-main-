-- Dynamic lookup for the "Job details" field, plus cleanup of an unwanted test
-- occupation value. "Other" is a UI affordance (LookupSelect includeOther), so
-- it is intentionally not stored as a lookup row.

-- Remove ONLY the unwanted test occupation value. Existing profile rows keep
-- their stored value untouched (no profile data is modified).
DELETE FROM public.lookup_options
WHERE category = 'occupation' AND value_en = 'O';

-- Initial seed list so the new Job details dropdown has values on day one.
-- Idempotent: existing custom values are never overwritten.
INSERT INTO public.lookup_options (category, value_en, value_ta) VALUES
('job_details','Software Engineer','மென்பொருள் பொறியாளர்'),
('job_details','Network Administrator','நெட்வொர்க் நிர்வாகி'),
('job_details','Data Analyst','தரவு பகுப்பாய்வாளர்'),
('job_details','Bank Officer','வங்கி அலுவலர்'),
('job_details','Construction Worker','கட்டுமானத் தொழிலாளர்'),
('job_details','Teacher','ஆசிரியர்'),
('job_details','Government Employee','அரசு ஊழியர்'),
('job_details','Business Owner','வணிக உரிமையாளர்')
ON CONFLICT (category, value_en) DO NOTHING;