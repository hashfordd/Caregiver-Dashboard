-- Items 85 + 108: extend audit_log triggers + reduce floor_plans payload.
--
--  • #85 — add audit triggers on caregiver_invites (full lifecycle) and
--    on caregivers (UPDATE-of-(provider_role, care_provider_id) only).
--    Until now those events left no trail; an admin issuing/revoking
--    invites or promoting a peer was invisible to the audit-log feed.
--  • #108 — exclude floor_plans.canvas_json from the JSONB payload.
--    canvas_json is uncapped; a 200-object canvas plus the editor's
--    save loop doubled canvas bytes into audit_log on every save.
--    The audit row still records what changed (timestamp, actor,
--    target_id), just without the canvas geometry.
--
-- Rollback: restore the prior audit_log_record body from
-- 20260507300000_audit_log_triggers.sql; drop the two new triggers.

-- ─────────────────────────────────────────────────────────────────────────
-- Trigger function: same as before but skip floor_plans.canvas_json.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.audit_log_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_provider uuid;
  v_target_id uuid;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  v_provider := public.audit_log_resolve_provider(tg_table_name, v_row);
  v_target_id := nullif(v_row->>'id', '')::uuid;

  -- #108: drop canvas_json from the payload — addressed-table specific.
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := case
      when tg_table_name = 'floor_plans' then to_jsonb(old) - 'canvas_json'
      else to_jsonb(old)
    end;
  else
    v_old := null;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new := case
      when tg_table_name = 'floor_plans' then to_jsonb(new) - 'canvas_json'
      else to_jsonb(new)
    end;
  else
    v_new := null;
  end if;

  insert into public.audit_log (actor_id, action, target_table, target_id, payload)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    v_target_id,
    jsonb_strip_nulls(jsonb_build_object(
      'audit_provider_id', v_provider,
      'before', v_old,
      'after', v_new
    ))
  );

  return coalesce(new, old);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- New triggers: caregiver_invites + caregivers role changes.
-- ─────────────────────────────────────────────────────────────────────────
drop trigger if exists audit_caregiver_invites on public.caregiver_invites;
create trigger audit_caregiver_invites
  after insert or update or delete on public.caregiver_invites
  for each row execute function public.audit_log_record();

drop trigger if exists audit_caregivers_role_changes on public.caregivers;
create trigger audit_caregivers_role_changes
  after update of provider_role, care_provider_id on public.caregivers
  for each row execute function public.audit_log_record();
