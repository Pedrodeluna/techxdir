-- Run against a fresh local stack: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/auto_ingest.sql
-- All fixtures and changes roll back.
begin;

-- The coverage check counts only what this test adds on top of existing data.
select set_config('test.synced_base', (select count(*)::text from public.events
  where external_kind = 'luma' and guests_synced_at is not null), true);

insert into auth.users (id, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000091', '{"name":"Ingest admin","user_name":"ti_admin"}'),
  ('00000000-0000-4000-8000-000000000092', '{"name":"Ingest guest","user_name":"ti_guest"}'),
  ('00000000-0000-4000-8000-000000000093', '{"name":"Ingest other","user_name":"ti_other"}'),
  ('00000000-0000-4000-8000-000000000094', '{"name":"Ingest typed","user_name":"ti_typed"}');
-- Only 092 and 093 signed in with X. 094 typed a handle, which does not count.
insert into auth.identities (provider_id, user_id, provider, identity_data, created_at, updated_at) values
  ('9002', '00000000-0000-4000-8000-000000000092', 'twitter', '{"user_name":"TI_Guest"}', now(), now()),
  ('9003', '00000000-0000-4000-8000-000000000093', 'twitter', '{"user_name":"ti_other"}', now(), now());
insert into public.app_admins (profile_id) values ('00000000-0000-4000-8000-000000000091');
insert into public.orgs (id, name) values ('test-ingest-org', 'Ingest test org'), ('test-ingest-other-org', 'Other test org');
insert into public.org_managers (org_id, profile_id) values ('test-ingest-org', '00000000-0000-4000-8000-000000000093');
insert into public.event_sources (id, org_id, kind, url, external_id)
values ('00000000-0000-4000-8000-0000000000e1', 'test-ingest-org', 'luma_calendar', 'https://luma.com/test-ingest', 'cal-test');

-- ingest_event: creates, updates, is idempotent and flags duplicates.
set local role service_role;
do $$
declare r jsonb;
begin
  r := public.ingest_event(jsonb_build_object(
    'external_kind', 'meetup', 'external_id', 'uid-1@meetup', 'org_id', 'test-ingest-org',
    'source_id', '00000000-0000-4000-8000-0000000000e1', 'id_base', 'test-ingest-noche-26',
    'name', 'Noche de IA Madrid', 'starts_at', '2030-03-05T18:30:00Z', 'city', 'Madrid', 'country', 'ES'));
  if r ->> 'action' <> 'created' or r ->> 'status' <> 'published' then
    raise exception 'meetup event not created as published: %', r;
  end if;
  r := public.ingest_event(jsonb_build_object(
    'external_kind', 'meetup', 'external_id', 'uid-1@meetup', 'org_id', 'test-ingest-org',
    'source_id', '00000000-0000-4000-8000-0000000000e1', 'id_base', 'test-ingest-noche-26',
    'name', 'Noche de IA Madrid', 'starts_at', '2030-03-05T18:30:00Z', 'city', 'Madrid', 'country', 'ES'));
  if r ->> 'action' <> 'unchanged' then raise exception 'second run was not a no-op: %', r; end if;

  -- The same event on Luma: Luma wins, the Meetup copy becomes a draft duplicate.
  r := public.ingest_event(jsonb_build_object(
    'external_kind', 'luma', 'external_id', 'evt-test-1', 'org_id', 'test-ingest-org',
    'source_id', '00000000-0000-4000-8000-0000000000e1', 'id_base', 'test-ingest-noche-26',
    'name', 'Noche de IA · Madrid', 'starts_at', '2030-03-05T18:30:00Z', 'city', 'Madrid', 'country', 'ES',
    'url', 'https://luma.com/noche-ia', 'guest_count', 120));
  if r ->> 'id' <> 'test-ingest-noche-26-2' or r ->> 'status' <> 'published' then
    raise exception 'luma event not created with a free id: %', r;
  end if;
  if (select status || ':' || duplicate_of from public.events where id = 'test-ingest-noche-26')
    <> 'draft:test-ingest-noche-26-2' then
    raise exception 'meetup twin was not marked as duplicate';
  end if;

  -- Outside Spain or without a source: draft.
  r := public.ingest_event(jsonb_build_object(
    'external_kind', 'luma', 'external_id', 'evt-test-2', 'org_id', 'test-ingest-org',
    'source_id', '00000000-0000-4000-8000-0000000000e1', 'id_base', 'test-ingest-lisboa-26',
    'name', 'Lisbon meetup', 'starts_at', '2030-03-06T18:00:00Z', 'city', 'Lisboa', 'country', 'PT'));
  if r ->> 'status' <> 'draft' then raise exception 'foreign event was published: %', r; end if;

  -- Canceled upstream, then a source sync that no longer lists it.
  r := public.ingest_event(jsonb_build_object(
    'external_kind', 'luma', 'external_id', 'evt-test-1', 'org_id', 'test-ingest-org',
    'source_id', '00000000-0000-4000-8000-0000000000e1', 'id_base', 'x',
    'name', 'Noche de IA · Madrid', 'starts_at', '2030-03-05T18:30:00Z', 'city', 'Madrid', 'country', 'ES',
    'canceled', true));
  if r ->> 'status' <> 'canceled' then raise exception 'event was not canceled: %', r; end if;
  r := public.ingest_event(jsonb_build_object(
    'external_kind', 'luma', 'external_id', 'evt-test-1', 'org_id', 'test-ingest-org',
    'source_id', '00000000-0000-4000-8000-0000000000e1', 'id_base', 'x',
    'name', 'Noche de IA · Madrid', 'starts_at', '2030-03-05T18:30:00Z', 'city', 'Madrid', 'country', 'ES'));
  if r ->> 'status' <> 'published' then raise exception 'event did not come back: %', r; end if;
  -- The Meetup duplicate and the Lisbon draft are no longer listed.
  if public.cancel_missing_events('00000000-0000-4000-8000-0000000000e1', array['evt-test-1']) <> 2 then
    raise exception 'missing events were not canceled';
  end if;

  -- Another organization cannot take over an imported event.
  r := public.ingest_event(jsonb_build_object(
    'external_kind', 'luma', 'external_id', 'evt-test-1', 'org_id', 'test-ingest-other-org',
    'source_id', null, 'id_base', 'x',
    'name', 'Hijacked', 'starts_at', '2031-01-01T18:00:00Z', 'city', 'Sevilla', 'country', 'ES'));
  if r ->> 'action' <> 'skipped' or (select name from public.events where id = 'test-ingest-noche-26-2') <> 'Noche de IA · Madrid' then
    raise exception 'an event of another organization was changed: %', r;
  end if;

  -- A published event that moves abroad goes back to draft.
  r := public.ingest_event(jsonb_build_object(
    'external_kind', 'luma', 'external_id', 'evt-test-3', 'org_id', 'test-ingest-org',
    'source_id', '00000000-0000-4000-8000-0000000000e1', 'id_base', 'test-ingest-taller-26',
    'name', 'Taller de agentes', 'starts_at', '2030-04-01T17:00:00Z', 'city', 'Valencia', 'country', 'ES'));
  if r ->> 'status' <> 'published' then raise exception 'taller not published: %', r; end if;
  r := public.ingest_event(jsonb_build_object(
    'external_kind', 'luma', 'external_id', 'evt-test-3', 'org_id', 'test-ingest-org',
    'source_id', '00000000-0000-4000-8000-0000000000e1', 'id_base', 'x',
    'name', 'Taller de agentes', 'starts_at', '2030-04-01T17:00:00Z', 'city', 'Lisboa', 'country', 'PT'));
  if r ->> 'status' <> 'draft' then raise exception 'event moved abroad stayed published: %', r; end if;
end $$;

-- ingest_event adopts the one event entered by hand that day, even renamed.
insert into public.events (id, org_id, name, short, city, starts_on, url, kind, color) values
  ('test-ingest-manual-003', 'test-ingest-org', 'TEST 003 • BDS', 'TEST 003 • BDS', 'Valencia', '2030-05-07', 'https://example.com/es', 'Meetup', '#111113'),
  ('test-ingest-manual-a', 'test-ingest-org', 'Mañana A', 'Mañana A', 'Madrid', '2030-05-08', null, 'Meetup', '#111113'),
  ('test-ingest-manual-b', 'test-ingest-org', 'Tarde B', 'Tarde B', 'Madrid', '2030-05-08', null, 'Meetup', '#111113');
do $$
declare r jsonb; e public.events;
begin
  r := public.ingest_event(jsonb_build_object(
    'external_kind', 'luma', 'external_id', 'evt-test-adopt', 'org_id', 'test-ingest-org',
    'source_id', '00000000-0000-4000-8000-0000000000e1', 'id_base', 'test-ingest-build-night-30',
    'name', 'TEST 003 × SOTI · BUILD NIGHT', 'short', 'TEST 003 × SOTI', 'url', 'https://luma.com/test-adopt',
    'starts_at', '2030-05-07T16:30:00Z', 'city', 'Valencia', 'country', 'ES'));
  select * into e from public.events where id = 'test-ingest-manual-003';
  if r ->> 'action' <> 'updated' or r ->> 'adopted' <> 'true' or r ->> 'id' <> 'test-ingest-manual-003' then
    raise exception 'manual event not adopted: %', r;
  end if;
  if e.external_id <> 'evt-test-adopt' or e.name <> 'TEST 003 × SOTI · BUILD NIGHT' or e.short <> 'TEST 003 × SOTI'
    or e.url <> 'https://luma.com/test-adopt' or e.source_id is null or e.status <> 'published' then
    raise exception 'adopted event not updated: %', row_to_json(e);
  end if;
  if exists (select 1 from public.events where external_id = 'evt-test-adopt' and id <> 'test-ingest-manual-003') then
    raise exception 'adoption created a second event';
  end if;
  -- Next sync finds it by its id like any other.
  r := public.ingest_event(jsonb_build_object(
    'external_kind', 'luma', 'external_id', 'evt-test-adopt', 'org_id', 'test-ingest-org',
    'source_id', '00000000-0000-4000-8000-0000000000e1', 'name', 'TEST 003 × SOTI · BUILD NIGHT',
    'url', 'https://luma.com/test-adopt', 'starts_at', '2030-05-07T16:30:00Z', 'city', 'Valencia', 'country', 'ES'));
  if r ->> 'action' <> 'unchanged' then raise exception 'adopted event not found again: %', r; end if;

  -- Two hand-made events that day: no guessing, the newcomer is created.
  r := public.ingest_event(jsonb_build_object(
    'external_kind', 'luma', 'external_id', 'evt-test-ambiguous', 'org_id', 'test-ingest-org',
    'source_id', '00000000-0000-4000-8000-0000000000e1', 'id_base', 'test-ingest-noche-c-30',
    'name', 'Noche C', 'starts_at', '2030-05-08T18:00:00Z', 'city', 'Madrid', 'country', 'ES'));
  if r ->> 'action' <> 'created' then raise exception 'ambiguous day was adopted: %', r; end if;
  if (select count(*) from public.events where id in ('test-ingest-manual-a', 'test-ingest-manual-b') and external_id is null) <> 2 then
    raise exception 'an ambiguous hand-made event was changed';
  end if;

  -- Another organization never takes it over.
  insert into public.events (id, org_id, name, short, city, starts_on, kind, color)
  values ('test-ingest-manual-other', 'test-ingest-other-org', 'Otra', 'Otra', 'Bilbao', '2030-05-09', 'Meetup', '#111113');
  r := public.ingest_event(jsonb_build_object(
    'external_kind', 'luma', 'external_id', 'evt-test-cross', 'org_id', 'test-ingest-org',
    'source_id', '00000000-0000-4000-8000-0000000000e1', 'id_base', 'test-ingest-cross-30',
    'name', 'Otra cosa', 'starts_at', '2030-05-09T18:00:00Z', 'city', 'Bilbao', 'country', 'ES'));
  if r ->> 'action' <> 'created' or (select external_id from public.events where id = 'test-ingest-manual-other') is not null then
    raise exception 'an event of another organization was adopted: %', r;
  end if;
end $$;

-- ingest_guests: stores handles, skips the rest, links verified handles only.
insert into public.suppressed_handles (handle) values ('ti_hidden');
do $$
declare r jsonb;
begin
  r := public.ingest_guests('test-ingest-noche-26-2', '[
    {"luma_user_id":"usr-a","handle":"ti_guest","name":"Guest","is_host":false},
    {"luma_user_id":"usr-b","handle":"ti_other","name":"Other","is_host":true},
    {"luma_user_id":"usr-c","handle":"ti_typed","name":"Typed"},
    {"luma_user_id":"usr-d","handle":"ti_hidden","name":"Hidden"},
    {"luma_user_id":"usr-e","handle":"not a handle!","name":"Bad"}
  ]'::jsonb, 120);
  if (r ->> 'stored')::int <> 3 or (r ->> 'linked')::int <> 2 then
    raise exception 'unexpected ingest_guests result: %', r;
  end if;
  if exists (select 1 from public.external_people where handle in ('ti_hidden'))
    or (select profile_id from public.external_people where handle = 'ti_typed') is not null then
    raise exception 'suppressed or unverified handles were stored or linked';
  end if;
  if (select guest_count from public.events where id = 'test-ingest-noche-26-2') <> 120 then
    raise exception 'guest_count not stored';
  end if;
end $$;

-- Anonymous people see neither drafts nor the guests.
set local role anon;
do $$ begin
  if exists (select 1 from public.events where id = 'test-ingest-noche-26') then
    raise exception 'anon sees a draft';
  end if;
  begin
    perform 1 from public.external_people;
    raise exception 'anon reads external_people';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.event_shadows();
    raise exception 'anon calls event_shadows';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role authenticated;

-- The guest: pending attendance is private, shadows hide themselves, review confirms.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000092', true);
do $$ begin
  if (select status from public.attendances where event_id = 'test-ingest-noche-26-2'
      and profile_id = '00000000-0000-4000-8000-000000000092') <> 'pending' then
    raise exception 'guest has no pending attendance';
  end if;
  if not exists (select 1 from public.event_shadows() where handle = 'ti_guest' and is_me) then
    raise exception 'own shadow not flagged';
  end if;
  begin
    perform public.ingest_event('{}'::jsonb);
    raise exception 'authenticated called ingest_event';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.attendances (profile_id, event_id, status)
    values ('00000000-0000-4000-8000-000000000092', 'test-ingest-noche-26-2', 'confirmed');
    raise exception 'status was written directly';
  exception when insufficient_privilege then null;
  end;
  if public.review_detected(array['test-ingest-noche-26-2'], true) <> 1 then
    raise exception 'review_detected confirmed nothing';
  end if;
  if exists (select 1 from public.event_shadows() where handle = 'ti_guest') then
    raise exception 'confirmed guest still shows as a shadow';
  end if;
  -- Unmarking keeps a dismissed row so the next sync does not bring it back.
  perform public.set_attendance('test-ingest-noche-26-2', false);
  if (select status from public.attendances where event_id = 'test-ingest-noche-26-2'
      and profile_id = '00000000-0000-4000-8000-000000000092') <> 'dismissed' then
    raise exception 'unmarking a detected event did not dismiss it';
  end if;
  begin
    perform public.set_attendance('test-ingest-noche-26', true);
    raise exception 'marked a draft event';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Another signed-in person does not see pending attendance of others, nor
-- guests linked to a user as shadows.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000094', true);
do $$ begin
  if exists (select 1 from public.attendances where status <> 'confirmed') then
    raise exception 'pending attendance of others is visible';
  end if;
  if exists (select 1 from public.event_shadows() where handle in ('ti_guest', 'ti_other'))
    or not exists (select 1 from public.event_shadows() where handle = 'ti_typed' and not is_me) then
    raise exception 'shadows show linked users or miss unlinked guests';
  end if;
  if exists (select 1 from public.event_sources) then
    raise exception 'a regular user sees sources';
  end if;
  begin
    perform public.hide_me(false);
    raise exception 'hide_me worked without a verified handle';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The manager and Luma host becomes an organizer when confirming.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000093', true);
do $$ begin
  if not exists (select 1 from public.event_sources) then
    raise exception 'manager does not see the source of their org';
  end if;
  if not exists (select 1 from public.events where id = 'test-ingest-noche-26') then
    raise exception 'manager does not see the draft of their org';
  end if;
  perform public.review_detected(array['test-ingest-noche-26-2'], true);
  if (select role from public.attendances where event_id = 'test-ingest-noche-26-2'
      and profile_id = '00000000-0000-4000-8000-000000000093') <> 'organizer' then
    raise exception 'host manager did not become organizer';
  end if;
  begin
    perform public.merge_events('test-ingest-noche-26', 'test-ingest-noche-26-2');
    raise exception 'manager merged events';
  exception when insufficient_privilege then null;
  end;
  -- "Ocultarme": deletes what was imported. A manager's account is kept.
  if public.hide_me(null) then
    raise exception 'hide_me deleted the account of a manager';
  end if;
  if exists (select 1 from public.event_shadows() where handle = 'ti_other') then
    raise exception 'hide_me left the shadow';
  end if;
end $$;

-- What only the importer sees: the suppression, and a guest whose X handle
-- changed is unlinked with its pending attendance. A detection does not undo
-- a dismissal when events are merged.
reset role;
set local role service_role;
do $$
declare r jsonb;
begin
  if not exists (select 1 from public.suppressed_handles where handle = 'ti_other') then
    raise exception 'hide_me did not suppress the handle';
  end if;
  r := public.ingest_guests('test-ingest-noche-26-2', '[{"luma_user_id":"usr-z","handle":"ti_other","name":"Again"}]'::jsonb, 120);
  if (r ->> 'stored')::int <> 0 then
    raise exception 'a suppressed handle was stored again';
  end if;
  insert into public.attendances (profile_id, event_id, source, status)
  values ('00000000-0000-4000-8000-000000000092', 'test-ingest-noche-26', 'luma', 'pending');
end $$;
reset role;
set local role authenticated;

-- The admin merges the duplicate and sees the coverage.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000091', true);
do $$ begin
  begin
    update public.events set status = 'merged' where id = 'test-ingest-noche-26';
    raise exception 'merged status set by hand';
  exception when invalid_parameter_value then null;
  end;
  perform public.merge_events('test-ingest-noche-26', 'test-ingest-noche-26-2');
  if (select status from public.events where id = 'test-ingest-noche-26') <> 'merged' then
    raise exception 'duplicate was not merged';
  end if;
  if (select status from public.attendances where event_id = 'test-ingest-noche-26-2'
      and profile_id = '00000000-0000-4000-8000-000000000092') <> 'dismissed' then
    raise exception 'merging brought a dismissed event back';
  end if;
  if (select synced_events from public.ingest_coverage()) <> current_setting('test.synced_base')::int + 1 then
    raise exception 'coverage does not count the synced event';
  end if;
end $$;

reset role;
update auth.identities set identity_data = '{"user_name":"ti_renamed"}'
where user_id = '00000000-0000-4000-8000-000000000092';
set local role service_role;
do $$ begin
  insert into public.attendances (profile_id, event_id, source, status)
  values ('00000000-0000-4000-8000-000000000092', 'test-ingest-taller-26', 'luma', 'pending');
  perform public.link_external_people(null, null);
  if (select profile_id from public.external_people where handle = 'ti_guest') is not null then
    raise exception 'a guest stayed linked after the X handle changed';
  end if;
  if exists (select 1 from public.attendances where profile_id = '00000000-0000-4000-8000-000000000092' and status = 'pending') then
    raise exception 'pending attendance of an old link was kept';
  end if;
end $$;

rollback;
