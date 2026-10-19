-- Verified 2026-10-19: Refugio and in-person Spanish Exponential events since June.
-- Sources and exclusions: docs/event-sources.md (Refugio / Exponential).
-- The Supabase migration runner owns the transaction. Insert only: never
-- overwrite manual edits, activate ingestion or create attendance/permissions.
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.orgs, public.events in share row exclusive mode;

create temporary table event_catalog_orgs (id text, name text) on commit drop;
insert into event_catalog_orgs (id, name) values
  ('refugio', 'REFUGIO'),
  ('exponential-fellowship', 'The Exponential Fellowship'),
  ('expresso-talks', 'Expresso Talks');

-- Fail atomically rather than attach events to an ambiguous organization.
do $$
begin
  if exists (
    select 1 from event_catalog_orgs s
    where (select count(*) from public.orgs o
           where o.id = s.id or lower(trim(o.name)) = lower(trim(s.name))) > 1
  ) then
    raise exception 'Ambiguous organization: resolve catalog matches before migrating';
  end if;
end;
$$;

create temporary table event_catalog_org_map on commit drop as
select s.id, coalesce(
  (select o.id from public.orgs o
   where o.id = s.id or lower(trim(o.name)) = lower(trim(s.name)) limit 1),
  s.id
) as target_id
from event_catalog_orgs s;

insert into public.orgs (id, name)
select m.target_id, s.name
from event_catalog_orgs s join event_catalog_org_map m using (id)
on conflict (id) do nothing;

create temporary table event_catalog_rows
  (like public.events including defaults) on commit drop;
insert into event_catalog_rows (
  id, org_id, name, short, city, starts_on, ends_on, url,
  kind, color, status, starts_at, ends_at, external_kind, external_id
) values
  ('refugio-madrid-20260627', 'refugio', 'Refugio Madrid 2026', 'Refugio Madrid', 'Madrid', '2026-06-27', null, 'https://refugiomadrid.com/',
   'Hackathon', '#ff4d00', 'published', '2026-06-27T09:00:00+02:00', null, null, null),
  ('exponential-6lzs6hsy', 'expresso-talks', 'Expresso Talks con Pablo Castro y Reyders Morales', 'Expresso Talks', 'Santiago de Compostela', '2026-10-15', null, 'https://luma.com/6lzs6hsy',
   'Comunidad', '#ff4d00', 'published', '2026-10-15T18:00:00.000+02:00', '2026-10-15T20:00:00.000+02:00', 'luma', 'evt-UsGfBM32Set5gkK'),
  ('exponential-pz3otdck', 'exponential-fellowship', '[Exponential Beers] François Derbaix (co-CEO, Indexa Capital) - Powered by Acurio Ventures', 'Exponential · François Derbaix', 'Madrid', '2026-09-28', null, 'https://luma.com/pz3otdck',
   'Comunidad', '#ff4d00', 'published', '2026-09-28T19:30:00.000+02:00', '2026-09-28T21:30:00.000+02:00', 'luma', 'evt-4527lcK0BrThynS'),
  ('exponential-bq85iasm', 'exponential-fellowship', '[Exponential Beers] Iñaki Berenguer (MITO, CoverWallet, LifeX, iPronics, and many more)', 'Exponential · Iñaki Berenguer', 'Madrid', '2026-09-22', null, 'https://luma.com/bq85iasm',
   'Comunidad', '#ff4d00', 'published', '2026-09-22T19:30:00.000+02:00', '2026-09-22T21:30:00.000+02:00', 'luma', 'evt-6cqLOfoWYPAPOfv');

-- IDs preserve manual edits; external identities and normalized Luma URLs
-- also recognize records entered under another catalog ID.
insert into public.events (
  id, org_id, name, short, city, starts_on, ends_on, url,
  kind, color, status, starts_at, ends_at, external_kind, external_id
)
select s.id, m.target_id, s.name, s.short, s.city, s.starts_on, s.ends_on, s.url,
       s.kind, s.color, s.status, s.starts_at, s.ends_at, s.external_kind, s.external_id
from event_catalog_rows s join event_catalog_org_map m on m.id = s.org_id
where not exists (
  select 1 from public.events e
  where e.id = s.id
    or (s.external_id is not null
        and e.external_kind = s.external_kind and e.external_id = s.external_id)
    or (e.starts_on = s.starts_on and lower(trim(e.city)) = lower(trim(s.city))
        and (lower(trim(e.name)) = lower(trim(s.name))
             or rtrim(regexp_replace(e.url, '^https?://(lu.ma|luma.com)/', 'https://luma.com/'), '/')
                = rtrim(regexp_replace(s.url, '^https?://(lu.ma|luma.com)/', 'https://luma.com/'), '/')))
)
on conflict (id) do nothing;
