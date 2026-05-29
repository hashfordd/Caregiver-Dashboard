-- F4 / UI-05: per-caregiver temperature unit preference (°C / °F).
--
-- Stored on caregivers; updatable by the caregiver themselves through the
-- existing caregivers_self_profile_update policy (the BEFORE UPDATE trigger
-- only blocks provider_role / care_provider_id / id, so a normal column
-- like this is freely self-updatable). Default 'c' preserves current
-- behaviour for every existing row.

alter table public.caregivers
  add column if not exists temperature_unit text not null default 'c'
    check (temperature_unit in ('c', 'f'));

comment on column public.caregivers.temperature_unit is
  'Display preference for temperature readings: c = Celsius, f = Fahrenheit. Readings are always stored in Celsius; conversion is presentation-only.';
