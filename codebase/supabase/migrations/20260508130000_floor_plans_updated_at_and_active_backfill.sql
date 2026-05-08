-- Items 92 + 104: floor_plans gains updated_at + auto-bump trigger so
-- FloorPlanEditor's concurrent-edit banner can fire (was load-bearing
-- on created_at, which UPDATE doesn't change), and a defensive
-- backfill of is_active in case the 20260507400000 migration ran on
-- a DB with multiple rows per patient.
--
-- The is_active backfill is idempotent on a clean DB (the predicate
-- only updates rows where the desired and actual values differ, so
-- repeated applications are no-ops).
--
-- Rollback:
--   alter table public.floor_plans drop column updated_at;
--   drop trigger floor_plans_set_updated_at on public.floor_plans;
--   drop function public.floor_plans_set_updated_at();
-- The is_active backfill cannot be rolled back automatically — once
-- a row's is_active flips, recovering the prior state needs a snapshot.

-- Item 104 — defensive backfill. Mark exactly the newest row per
-- patient as active; older rows become archived. Idempotent.
update public.floor_plans fp
set is_active = (
  fp.id = (
    select id from public.floor_plans
    where patient_id = fp.patient_id
    order by created_at desc
    limit 1
  )
)
where fp.is_active is distinct from (
  fp.id = (
    select id from public.floor_plans
    where patient_id = fp.patient_id
    order by created_at desc
    limit 1
  )
);

-- Item 92 — updated_at column + auto-bump trigger.
alter table public.floor_plans
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.floor_plans_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists floor_plans_set_updated_at on public.floor_plans;
create trigger floor_plans_set_updated_at
  before update on public.floor_plans
  for each row execute function public.floor_plans_set_updated_at();
