alter table public.profiles
  add column if not exists brothers integer,
  add column if not exists sisters integer;

alter table public.profiles
  add constraint profiles_brothers_nonnegative_chk check (brothers is null or brothers >= 0),
  add constraint profiles_sisters_nonnegative_chk check (sisters is null or sisters >= 0);

comment on column public.profiles.brothers is 'Number of brothers (admin create/edit). Legacy combined siblings text column is kept untouched.';
comment on column public.profiles.sisters is 'Number of sisters (admin create/edit). Legacy combined siblings text column is kept untouched.';