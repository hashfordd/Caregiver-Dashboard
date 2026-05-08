-- F11: rename patients.notes → patients.description (the existing column has
-- always been used as a short bio/condition summary), and introduce a proper
-- patient_notes log so caregivers can leave timestamped care notes.
--
-- Rollback (item 146): DATA-LOSSY if patient_notes has rows. To revert:
--   alter table public.patients rename column description to notes;
--   drop table public.patient_notes;        -- destroys per-care notes
--   drop function public.create_patient_with_allocation(text, date, text);
--   -- Re-create the original RPC signature with p_notes parameter.
-- The patient_notes contents cannot be reconstructed from the rename
-- alone; back up the table before rolling back if any rows exist.

-- patients.notes → patients.description ─────────────────────────────────────
alter table public.patients rename column notes to description;

-- The create_patient_with_allocation RPC's signature includes p_notes, so we
-- have to drop and recreate it with the renamed parameter.
drop function if exists public.create_patient_with_allocation(text, date, text);

create or replace function public.create_patient_with_allocation(
  p_full_name text,
  p_dob date default null,
  p_description text default null
) returns public.patients
language plpgsql
security definer
set search_path = public
as $$
declare
  new_patient public.patients;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'auth required';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'full_name required';
  end if;

  insert into public.patients (full_name, dob, description, primary_caregiver_id)
  values (p_full_name, p_dob, p_description, caller)
  returning * into new_patient;

  insert into public.caregiver_patient (caregiver_id, patient_id, role)
  values (caller, new_patient.id, 'creator');

  return new_patient;
end;
$$;

revoke all on function public.create_patient_with_allocation(text, date, text) from public;
grant execute on function public.create_patient_with_allocation(text, date, text) to authenticated;

-- patient_notes ─────────────────────────────────────────────────────────────
-- Care log: timestamped notes left by caregivers on a patient. author_name is
-- a denormalised snapshot (the caregiver's full_name at write time) so the UI
-- can show authorship without needing to read other caregivers' rows — that
-- avoids loosening caregivers_self_read just for this view.
create table public.patient_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  author_caregiver_id uuid references public.caregivers(id) on delete set null,
  author_name text not null,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index patient_notes_patient_created_idx
  on public.patient_notes(patient_id, created_at desc);

alter table public.patient_notes enable row level security;

create policy patient_notes_allocated_read on public.patient_notes
  for select using (public.is_caregiver_for(patient_id));

create policy patient_notes_allocated_insert on public.patient_notes
  for insert with check (
    public.is_caregiver_for(patient_id)
    and author_caregiver_id = auth.uid()
  );

-- Authors may delete or amend their own notes; editing someone else's note is
-- out of scope for V1.
create policy patient_notes_author_update on public.patient_notes
  for update using (author_caregiver_id = auth.uid())
  with check (author_caregiver_id = auth.uid());

create policy patient_notes_author_delete on public.patient_notes
  for delete using (author_caregiver_id = auth.uid());

alter publication supabase_realtime add table public.patient_notes;
