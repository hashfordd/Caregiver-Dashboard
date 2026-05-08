-- Lock down the vault-resolver helper functions added by
-- 20260506100200_rules_engine_webhooks_and_cron.sql.
--
-- These functions are SECURITY DEFINER and read from
-- vault.decrypted_secrets. Postgres grants EXECUTE to PUBLIC by default
-- on new functions, which means any role with a connection to the
-- database (anon, authenticated) could call them and resolve any vault
-- secret by name, or trigger arbitrary edge-function POSTs server-side.
--
-- Revoke the default PUBLIC grants. The trigger functions
-- (alerts_dispatch_webhook) call these helpers as their definer-owner
-- (postgres role), which has implicit privilege regardless of the
-- PUBLIC grant — so removing PUBLIC EXECUTE does not break the
-- legitimate webhook fan-out.

revoke all on function public.alerts_vault_get(text) from public, anon, authenticated;
revoke all on function public.alerts_post_rules_engine(jsonb) from public, anon, authenticated;
revoke all on function public.alerts_post_inactivity_scan() from public, anon, authenticated;
