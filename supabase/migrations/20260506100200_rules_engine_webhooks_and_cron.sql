-- F11 Phase 4: rules engine wiring (DB webhooks + cron schedule).
--
-- Two concerns covered here:
--   1. AFTER INSERT triggers on sensor_readings, position_estimates,
--      events that call the rules_engine edge function with the inserted
--      row as the payload (the standard Supabase webhook shape).
--   2. A pg_cron job that hits inactivity_scan every 60 seconds.
--
-- Secrets handling: the service-role key cannot be committed. The trigger
-- functions read the function URL and bearer token from Supabase Vault.
-- Set up once per environment via the SQL editor:
--
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1',
--     'edge_functions_base_url'
--   );
--   select vault.create_secret(
--     '<service-role-key>',
--     'edge_functions_service_role_key'
--   );
--
-- Updates: select vault.update_secret(secret_id, new_value, ...).
-- Read via `select decrypted_secret from vault.decrypted_secrets where name = $1`.
--
-- The triggers no-op cleanly if either secret is missing — the webhook
-- log warns once but the originating INSERT still commits, so a missing
-- secret never blocks data ingestion.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Helper: resolve a Vault secret by name, returning NULL if absent.
create or replace function public.alerts_vault_get(p_name text)
returns text
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_value text;
begin
  select decrypted_secret into v_value
    from vault.decrypted_secrets
   where name = p_name
   limit 1;
  return v_value;
end;
$$;

-- Helper: post a JSON body to the rules_engine endpoint with the
-- service-role bearer. Returns the request id on success, null when the
-- vault secrets aren't configured.
create or replace function public.alerts_post_rules_engine(p_body jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_base text := public.alerts_vault_get('edge_functions_base_url');
  v_key  text := public.alerts_vault_get('edge_functions_service_role_key');
  v_req_id bigint;
begin
  if v_base is null or v_key is null then
    raise notice 'alerts_post_rules_engine: vault secrets missing; skipping';
    return null;
  end if;
  select net.http_post(
    url := v_base || '/rules_engine',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || v_key
    ),
    body := p_body
  ) into v_req_id;
  return v_req_id;
end;
$$;

-- Trigger function: builds the standard Supabase webhook payload shape
-- ({ type, table, schema, record, old_record }) and posts to the engine.
create or replace function public.alerts_dispatch_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.alerts_post_rules_engine(jsonb_build_object(
    'type', tg_op,
    'table', tg_table_name,
    'schema', tg_table_schema,
    'record', to_jsonb(new),
    'old_record', null
  ));
  return new;
exception
  when others then
    -- Never block the originating INSERT on a webhook failure.
    raise warning 'alerts_dispatch_webhook(%): %', tg_table_name, sqlerrm;
    return new;
end;
$$;

create trigger sensor_readings_alerts_dispatch
after insert on public.sensor_readings
for each row execute function public.alerts_dispatch_webhook();

create trigger position_estimates_alerts_dispatch
after insert on public.position_estimates
for each row execute function public.alerts_dispatch_webhook();

create trigger events_alerts_dispatch
after insert on public.events
for each row execute function public.alerts_dispatch_webhook();

-- Cron: inactivity_scan every 60 seconds. The job posts an empty body
-- (the function reads `now()` server-side and loops over enabled rules
-- itself).
create or replace function public.alerts_post_inactivity_scan()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_base text := public.alerts_vault_get('edge_functions_base_url');
  v_key  text := public.alerts_vault_get('edge_functions_service_role_key');
begin
  if v_base is null or v_key is null then
    raise notice 'alerts_post_inactivity_scan: vault secrets missing; skipping';
    return;
  end if;
  perform net.http_post(
    url := v_base || '/inactivity_scan',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb
  );
end;
$$;

-- Schedule (idempotent: unschedule first if it already exists). The
-- DO block tolerates the first-time case where the job doesn't exist.
do $do$
begin
  perform cron.unschedule('inactivity_scan_every_minute');
exception when others then
  null;
end
$do$;

select cron.schedule(
  'inactivity_scan_every_minute',
  '* * * * *',
  $$select public.alerts_post_inactivity_scan();$$
);
