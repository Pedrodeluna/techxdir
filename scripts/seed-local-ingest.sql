-- Local demo data for the ingestion. Fake people only.
-- psql "$DB_URL" -f scripts/seed-local-ingest.sql
insert into public.orgs (id, name, logo) values ('demo-ia-madrid', 'Demo IA Madrid', '{"mark":"IA","shape":"hex"}')
on conflict do nothing;
insert into public.event_sources (id, org_id, kind, url, external_id, name)
values ('00000000-0000-4000-8000-00000000d001', 'demo-ia-madrid', 'luma_calendar', 'https://luma.com/demo-ia-madrid', 'cal-demo', 'Demo IA Madrid')
on conflict do nothing;

select public.ingest_event(jsonb_build_object(
  'external_kind', 'meetup', 'external_id', 'demo-uid-1@meetup', 'org_id', 'demo-ia-madrid',
  'source_id', '00000000-0000-4000-8000-00000000d001', 'id_base', 'demo-noche-ia',
  'name', 'Noche de IA Madrid', 'starts_at', (current_date + 10)::text || 'T17:30:00Z', 'city', 'Madrid', 'country', 'ES'));
select public.ingest_event(jsonb_build_object(
  'external_kind', 'luma', 'external_id', 'evt-demo-1', 'org_id', 'demo-ia-madrid',
  'source_id', '00000000-0000-4000-8000-00000000d001', 'id_base', 'demo-noche-ia',
  'name', 'Noche de IA · Madrid', 'starts_at', (current_date + 10)::text || 'T17:30:00Z', 'city', 'Madrid', 'country', 'ES',
  'url', 'https://luma.com/demo-noche-ia', 'guest_count', 64));

select public.ingest_guests('demo-noche-ia-2', '[
  {"luma_user_id":"usr-demo-1","handle":"demo_lucia","name":"Lucía Demo","is_host":true},
  {"luma_user_id":"usr-demo-2","handle":"demo_marcos","name":"Marcos Demo"},
  {"luma_user_id":"usr-demo-3","handle":"demo_irene","name":"Irene Demo"}
]'::jsonb, 64);

insert into public.import_suggestions (kind, external_id, url, name, city, found_via)
values ('luma_calendar', 'cal-demo-suggested', 'https://luma.com/demo-suggested', 'Demo Startups BCN', 'Barcelona', 'discover:barcelona')
on conflict do nothing;
