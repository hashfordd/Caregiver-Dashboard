-- Caregivers belong to a company (hospital, care home, homecare service, or
-- "Family" for unaffiliated relatives). The column is nullable so existing
-- rows are unaffected; the profile page is the place to set / edit it.

alter table public.caregivers add column if not exists company_name text;

-- Extend handle_new_user so signups that include `company_name` in
-- raw_user_meta_data carry it onto the caregivers row.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.caregivers (id, email, full_name, role, company_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::public.caregiver_role, 'family'),
    new.raw_user_meta_data->>'company_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
