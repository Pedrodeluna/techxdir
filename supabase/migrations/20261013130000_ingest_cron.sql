-- Schedules the ingestion. The functions are reached through pg_net with the
-- project URL and the shared secret stored in the vault:
--
--   select vault.create_secret('https://<project>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as CRON_SECRET>', 'cron_secret');
--
-- Locally: 'http://kong:8000' and the CRON_SECRET of supabase/functions/.env.
-- Without both secrets the jobs do nothing.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function public.call_ingest(fn text, body jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if base is null or secret is null then
    return null;
  end if;
  return net.http_post(
    url := rtrim(base, '/') || '/functions/v1/' || fn,
    body := body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    timeout_milliseconds := 150000
  );
end;
$$;
revoke all on function public.call_ingest(text, jsonb) from public, anon, authenticated;

-- Sources once a day, with three retries for whatever did not fit (UTC).
select cron.schedule('ingest-sources', '0 4-7 * * *', $$select public.call_ingest('sync-sources', '{"job":"sources"}')$$);
-- Discovery on Mondays.
select cron.schedule('ingest-discover', '30 4 * * 1', $$select public.call_ingest('sync-sources', '{"job":"discover"}')$$);
-- Guests every hour; each event is read again after 6 hours.
select cron.schedule('ingest-guests', '15 * * * *', $$select public.call_ingest('sync-guests')$$);
-- Retention on the first day of the month.
select cron.schedule('ingest-retention', '0 3 1 * *', $$select public.run_retention()$$);
