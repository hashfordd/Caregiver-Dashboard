-- Phase F item 49: enforce one active floor plan per patient.
--
-- Audit flagged that two simultaneous saves from different tabs could
-- both INSERT a brand-new row (the front-end picks "most recent" at
-- read time) and produce silent duplicates. A UNIQUE partial index
-- gates that at the database layer; the schema still allows multiple
-- inactive plans per patient, which is the V2 path for "swap to a new
-- floor plan version while keeping the previous one for replay".
--
-- For now (Phase F, single-floor-plan-per-patient), every existing
-- row defaults to is_active=true and the partial index prevents a
-- second active row.

alter table public.floor_plans
  add column is_active boolean not null default true;

create unique index floor_plans_one_active_per_patient
  on public.floor_plans (patient_id)
  where is_active;

comment on column public.floor_plans.is_active is
  'Exactly one active row per patient (UNIQUE partial index). Inactive rows are kept for replay and history.';
