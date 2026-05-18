-- F9 enhancement: per-patient care setting (home base) location.
--
-- The Outdoor map view renders a marker at this point so caregivers can
-- see how far the patient is from their care setting at a glance, and
-- the dashboard can later use it for "wandered away" rules.
--
-- All three columns are nullable: a patient may have no care setting
-- configured yet, in which case the map hides the marker and the
-- distance overlay.

alter table public.patients
  add column care_setting_lat numeric(9, 6),
  add column care_setting_lng numeric(9, 6),
  add column care_setting_label text;

-- NULL is allowed (no care setting). Non-null values must be valid
-- WGS-84 coordinates; label has a sane display cap.
alter table public.patients
  add constraint patients_care_setting_lat_range
    check (care_setting_lat is null or care_setting_lat between -90 and 90),
  add constraint patients_care_setting_lng_range
    check (care_setting_lng is null or care_setting_lng between -180 and 180),
  add constraint patients_care_setting_label_length
    check (care_setting_label is null or length(care_setting_label) <= 120);

-- A point location needs both coordinates or neither.
alter table public.patients
  add constraint patients_care_setting_paired
    check ((care_setting_lat is null) = (care_setting_lng is null));

comment on column public.patients.care_setting_lat is
  'Care setting (home base) latitude. F9 outdoor map renders a marker at this point and computes distance from the live patient pin.';
comment on column public.patients.care_setting_lng is
  'Care setting (home base) longitude. See care_setting_lat.';
comment on column public.patients.care_setting_label is
  'Optional display label for the care setting marker (e.g. "Home", "Riverside facility").';
