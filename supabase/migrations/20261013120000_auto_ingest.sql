-- Automatic import of events (Luma calendars and Meetup iCal feeds) and of
-- the public guest samples of Luma events, matched to verified X handles.
-- See docs/spec-auto-ingest.md and docs/plan-auto-ingest.md.

create extension if not exists pg_trgm with schema extensions;

-- ───────── Sources and discovery ─────────

-- Curated feeds the events are read from.
create table public.event_sources (
  id             uuid primary key default gen_random_uuid(),
  org_id         text not null references public.orgs (id) on delete cascade,
  kind           text not null check (kind in ('luma_calendar', 'meetup_ical')),
  url            text not null unique,
  external_id    text not null,                 -- cal-… on Luma; group urlname on Meetup
  name           text not null default '' check (char_length(name) <= 120),
  country_filter text check (country_filter ~ '^[A-Z]{2}$'), -- 'ES' on global calendars; null = no filter
  enabled        boolean not null default true,
  last_synced_at timestamptz,
  last_error     text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (kind, external_id)
);
create index event_sources_org_id_idx on public.event_sources (org_id);

-- Proposals from the weekly discovery. Nothing here is imported on its own,
-- and a dismissed proposal never comes back.
create table public.import_suggestions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('luma_calendar', 'luma_event')),
  external_id text not null unique,             -- cal-… or evt-…
  url         text not null,
  name        text not null,
  city        text,
  starts_on   date,                             -- events only
  found_via   text not null,                    -- e.g. 'discover:madrid'
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  created_at  timestamptz not null default now()
);

-- ───────── Guests seen on Luma ─────────

-- Only guests with an X handle are stored.
create table public.external_people (
  id           uuid primary key default gen_random_uuid(),
  luma_user_id text not null unique,            -- usr-…
  handle       text not null check (handle ~ '^[a-z0-9_]{1,15}$'),
  name         text not null default '',
  avatar_url   text,
  profile_id   uuid references public.profiles (id) on delete set null, -- set when matched to a user
  last_seen_on date not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index external_people_handle_idx on public.external_people (handle);
create index external_people_profile_id_idx on public.external_people (profile_id) where profile_id is not null;

create table public.event_guests (
  event_id      text not null references public.events (id) on delete cascade,
  person_id     uuid not null references public.external_people (id) on delete cascade,
  is_host       boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (event_id, person_id)
);
create index event_guests_person_id_idx on public.event_guests (person_id);

-- Handles that asked not to appear. Never deleted.
create table public.suppressed_handles (
  handle     text primary key check (handle ~ '^[a-z0-9_]{1,15}$'),
  created_at timestamptz not null default now()
);

-- One row per sync run, shown in /admin.
create table public.sync_runs (
  id          bigint generated always as identity primary key,
  job         text not null check (job in ('sources', 'discover', 'guests', 'retention')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  stats       jsonb not null default '{}'::jsonb,
  error       text
);
create index sync_runs_started_at_idx on public.sync_runs (started_at desc);

create table public.app_settings (
  key   text primary key,
  value jsonb not null
);
insert into public.app_settings (key, value) values
  ('guest_ingest_enabled', 'true'::jsonb),
  ('luma_full_list_enabled', 'false'::jsonb),
  ('luma_last_request', to_jsonb('2000-01-01T00:00:00Z'::text)); -- shared pace of every call to Luma

-- ───────── events ─────────

alter table public.events
  add column source_id        uuid references public.event_sources (id) on delete set null,
  add column external_kind    text check (external_kind in ('luma', 'meetup')),
  add column external_id      text,              -- evt-… on Luma; VEVENT UID on Meetup
  add column status           text not null default 'published'
    check (status in ('draft', 'published', 'canceled', 'merged')),
  add column starts_at        timestamptz,       -- exact time; starts_on stays the date in Europe/Madrid
  add column ends_at          timestamptz,
  add column guest_count      integer check (guest_count >= 0), -- Luma total, guests without a handle included
  add column guests_synced_at timestamptz,
  add column guests_frozen    boolean not null default false,
  add column synced_at        timestamptz,       -- last time the importer read this event
  add column duplicate_of     text references public.events (id) on delete set null,
  add constraint events_external_pair check ((external_kind is null) = (external_id is null));
create unique index events_external_key on public.events (external_kind, external_id)
  where external_id is not null;
create index events_status_idx on public.events (status);
create index events_source_id_idx on public.events (source_id) where source_id is not null;

-- Drafts, canceled and merged events are only visible to admins and to the
-- managers of their organization.
drop policy "events are public" on public.events;
create policy "published events are public" on public.events
  for select to anon using (status = 'published');
create policy "signed-in people see published events and the ones they run" on public.events
  for select to authenticated
  using (status = 'published' or (select public.is_app_admin()) or (select public.manages_org(org_id)));

-- Admins and managers publish drafts and resolve duplicates. Merging only
-- happens through merge_events().
grant update (status, duplicate_of) on public.events to authenticated;

create function public.guard_event_review() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated')
    and (new.status is distinct from old.status or new.duplicate_of is distinct from old.duplicate_of)
  then
    if not (public.is_app_admin() or public.manages_org(old.org_id)) then
      raise exception 'only admins and managers review imported events' using errcode = '42501';
    end if;
    if new.status = 'merged' or old.status = 'merged' then
      raise exception 'merged events change only through merge_events' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger events_guard_review
  before update on public.events
  for each row execute function public.guard_event_review();

-- ───────── attendances ─────────

alter table public.attendances
  add column source text not null default 'manual' check (source in ('manual', 'luma')),
  add column status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'dismissed'));
create index attendances_pending_idx on public.attendances (profile_id) where status = 'pending';

-- Pending and dismissed attendance is private to its owner.
drop policy "attendance is visible to signed-in people" on public.attendances;
create policy "confirmed attendance is visible to signed-in people" on public.attendances
  for select to authenticated
  using (status = 'confirmed' or profile_id = (select auth.uid()));

-- Source and status are only set by the functions below.
revoke insert on public.attendances from anon, authenticated;
grant insert (profile_id, event_id, role) on public.attendances to authenticated;

-- Deleting a row would let the next sync bring a dismissed or detected event
-- back. People delete only what they added by hand (the badge goes through
-- set_attendance); managers never remove a dismissal.
drop policy "people unmark their own attendance" on public.attendances;
create policy "people unmark their own attendance" on public.attendances
  for delete to authenticated using ((select auth.uid()) = profile_id and source = 'manual');
drop policy "managers remove attendance" on public.attendances;
create policy "managers remove attendance" on public.attendances
  for delete to authenticated using ((select public.manages_event(event_id)) and status <> 'dismissed');

-- An organizer is an organizer while their attendance is confirmed.
create or replace function public.organizes_event(event text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.attendances a
    where a.event_id = event and a.profile_id = (select auth.uid())
      and a.role = 'organizer' and a.status = 'confirmed'
  );
$$;

-- ───────── Row level security of the new tables ─────────

alter table public.event_sources enable row level security;
alter table public.import_suggestions enable row level security;
alter table public.external_people enable row level security;
alter table public.event_guests enable row level security;
alter table public.suppressed_handles enable row level security;
alter table public.sync_runs enable row level security;
alter table public.app_settings enable row level security;

-- external_people, event_guests and suppressed_handles are read only
-- through the security definer functions below.
revoke all on public.event_sources, public.import_suggestions, public.external_people, public.event_guests,
  public.suppressed_handles, public.sync_runs, public.app_settings from anon, authenticated;

-- Sources: admins see all of them, managers the ones of their organization.
-- They are created by the add-url function, which checks the same rule.
grant select, delete on public.event_sources to authenticated;
grant update (enabled, country_filter) on public.event_sources to authenticated;
create policy "admins and managers see sources" on public.event_sources
  for select to authenticated
  using ((select public.is_app_admin()) or (select public.manages_org(org_id)));
create policy "admins and managers edit sources" on public.event_sources
  for update to authenticated
  using ((select public.is_app_admin()) or (select public.manages_org(org_id)))
  with check ((select public.is_app_admin()) or (select public.manages_org(org_id)));
create policy "admins and managers remove sources" on public.event_sources
  for delete to authenticated
  using ((select public.is_app_admin()) or (select public.manages_org(org_id)));
create policy "banned people cannot edit sources" on public.event_sources
  as restrictive for update to authenticated using (not (select public.is_banned()));
create policy "banned people cannot remove sources" on public.event_sources
  as restrictive for delete to authenticated using (not (select public.is_banned()));

grant select on public.import_suggestions to authenticated;
grant update (status) on public.import_suggestions to authenticated;
create policy "admins see suggestions" on public.import_suggestions
  for select to authenticated using ((select public.is_app_admin()));
create policy "admins review suggestions" on public.import_suggestions
  for update to authenticated
  using ((select public.is_app_admin()))
  with check ((select public.is_app_admin()));

grant select on public.sync_runs to authenticated;
create policy "admins see sync runs" on public.sync_runs
  for select to authenticated using ((select public.is_app_admin()));

grant select on public.app_settings to authenticated;
grant update (value) on public.app_settings to authenticated;
create policy "admins see settings" on public.app_settings
  for select to authenticated using ((select public.is_app_admin()));
create policy "admins change settings" on public.app_settings
  for update to authenticated
  using ((select public.is_app_admin()))
  with check ((select public.is_app_admin()));

-- ───────── Verified handles and matching ─────────

-- The X handle of a person who signed in with X (OAuth 1.0a 'twitter', or
-- 'x' after a move to OAuth 2.0). A handle typed on /auth/callback does not count.
create function public.verified_handle(profile uuid) returns text
language sql stable security definer set search_path = '' as $$
  select lower(coalesce(i.identity_data ->> 'user_name', i.identity_data ->> 'preferred_username'))
  from auth.identities i
  where i.user_id = profile and i.provider in ('twitter', 'x')
  order by i.updated_at desc nulls last
  limit 1;
$$;

-- Links Luma guests to the users with the same verified handle and creates
-- their pending attendance. Manual and dismissed attendance is kept.
-- A link whose handle no longer matches (the Luma or the X handle changed)
-- is dropped first, with the pending attendance it produced.
create function public.link_external_people(only_profile uuid default null, only_event text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare added integer;
begin
  update public.external_people p set profile_id = null, updated_at = now()
  where p.profile_id is not null
    and (only_profile is null or p.profile_id = only_profile)
    and p.handle is distinct from public.verified_handle(p.profile_id);

  delete from public.attendances a
  where a.source = 'luma' and a.status = 'pending'
    and (only_profile is null or a.profile_id = only_profile)
    and not exists (
      select 1 from public.event_guests g
      join public.external_people p on p.id = g.person_id
      where g.event_id = a.event_id and p.profile_id = a.profile_id
    );

  update public.external_people p set profile_id = v.user_id, updated_at = now()
  from (
    select distinct on (lower(coalesce(i.identity_data ->> 'user_name', i.identity_data ->> 'preferred_username')))
      i.user_id,
      lower(coalesce(i.identity_data ->> 'user_name', i.identity_data ->> 'preferred_username')) as handle
    from auth.identities i
    join public.profiles pr on pr.id = i.user_id
    where i.provider in ('twitter', 'x') and (only_profile is null or i.user_id = only_profile)
    order by lower(coalesce(i.identity_data ->> 'user_name', i.identity_data ->> 'preferred_username')), i.updated_at desc nulls last
  ) v
  where p.handle = v.handle and p.profile_id is distinct from v.user_id;

  insert into public.attendances (profile_id, event_id, source, status)
  select p.profile_id, g.event_id, 'luma', 'pending'
  from public.event_guests g
  join public.external_people p on p.id = g.person_id
  join public.events e on e.id = g.event_id
  where p.profile_id is not null
    and e.status = 'published'
    and (only_profile is null or p.profile_id = only_profile)
    and (only_event is null or g.event_id = only_event)
    and not exists (select 1 from public.bans b where b.profile_id = p.profile_id)
  on conflict (profile_id, event_id) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

-- Called by the app after signing in.
create function public.claim_detected_attendances() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or public.is_banned() then
    return 0;
  end if;
  return public.link_external_people((select auth.uid()), null);
end;
$$;

-- "Voy"/"Fui" from the badge. Unmarking an event where the person was seen
-- on Luma keeps a dismissed mark so the next sync does not bring it back.
create function public.set_attendance(target_event text, going boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if public.is_banned() then
    raise exception 'banned people cannot change attendance' using errcode = '42501';
  end if;
  if going then
    if not exists (select 1 from public.events e where e.id = target_event and e.status = 'published') then
      raise exception 'event not found' using errcode = '22023';
    end if;
    insert into public.attendances (profile_id, event_id, source, status)
    values (me, target_event, 'manual', 'confirmed')
    on conflict (profile_id, event_id) do update set status = 'confirmed';
  elsif exists (
    select 1 from public.event_guests g
    join public.external_people p on p.id = g.person_id
    where g.event_id = target_event and p.profile_id = me
  ) then
    insert into public.attendances (profile_id, event_id, source, status)
    values (me, target_event, 'luma', 'dismissed')
    on conflict (profile_id, event_id) do update set status = 'dismissed', role = 'attendee';
  else
    delete from public.attendances a where a.profile_id = me and a.event_id = target_event;
  end if;
end;
$$;

-- Confirms or dismisses detected (pending) attendance. A Luma host who
-- manages the organization becomes an organizer of the event.
create function public.review_detected(event_ids text[], accept boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  changed integer;
begin
  if me is null or public.is_banned() then
    raise exception 'cannot review attendance' using errcode = '42501';
  end if;
  update public.attendances a set
    status = case when accept then 'confirmed' else 'dismissed' end,
    role = case
      when accept
        and exists (
          select 1 from public.event_guests g
          join public.external_people p on p.id = g.person_id
          where g.event_id = a.event_id and p.profile_id = me and g.is_host
        )
        and exists (
          select 1 from public.events e
          join public.org_managers m on m.org_id = e.org_id
          where e.id = a.event_id and m.profile_id = me
        )
      then 'organizer'
      else a.role
    end
  where a.profile_id = me and a.status = 'pending' and a.event_id = any (event_ids);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- Luma guests who are not users, for signed-in people only. The public
-- badge pages never call this. A guest linked to a user never shows: their
-- detected attendance is private until they confirm it, and then they appear
-- as themselves. The caller also gets their own pending rows (is_me).
create function public.event_shadows()
returns table (event_id text, person_id uuid, handle text, name text, avatar_url text, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select g.event_id, p.id, p.handle, p.name, p.avatar_url, p.profile_id is not null
  from public.event_guests g
  join public.external_people p on p.id = g.person_id
  join public.events e on e.id = g.event_id and e.status = 'published'
  where (select auth.uid()) is not null
    and (p.profile_id is null or p.profile_id = (select auth.uid()))
    and not exists (
      select 1 from public.attendances a
      where a.profile_id = p.profile_id and a.event_id = g.event_id and a.status in ('confirmed', 'dismissed')
    )
    and not exists (select 1 from public.suppressed_handles s where s.handle = p.handle)
  order by g.event_id, p.id;
$$;

-- "Ocultarme": needs a verified X handle. Suppresses it for good and deletes
-- what was imported about it. delete_account: true deletes the account,
-- false keeps it, null (the default) deletes it only when it was created in
-- the last 30 minutes and has nothing of its own yet, which is the account
-- the X sign-in of /privacidad created just to prove the handle.
-- Returns whether the account was deleted.
create function public.hide_me(delete_account boolean default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  h text := public.verified_handle((select auth.uid()));
  drop_it boolean := delete_account;
begin
  if me is null or h is null or h !~ '^[a-z0-9_]{1,15}$' then
    raise exception 'sign in with X to hide your handle' using errcode = '42501';
  end if;
  insert into public.suppressed_handles (handle) values (h) on conflict do nothing;
  delete from public.attendances a where a.profile_id = me and a.source = 'luma' and a.status <> 'confirmed';
  delete from public.external_people p where p.handle = h or p.profile_id = me;
  if drop_it is null then
    drop_it := exists (select 1 from auth.users u where u.id = me and u.created_at > now() - interval '30 minutes')
      and not exists (select 1 from public.attendances a where a.profile_id = me)
      and not exists (select 1 from public.org_managers m where m.profile_id = me)
      and not exists (select 1 from public.app_admins x where x.profile_id = me);
  end if;
  if drop_it then
    delete from auth.users u where u.id = me;
  end if;
  return drop_it;
end;
$$;

-- ───────── Admin review ─────────

-- Moves attendance and guests of a duplicate to the main event. Confirmed
-- wins; otherwise a dismissal wins over a detection, so nothing the person
-- already said no to comes back.
create function public.merge_events(duplicate text, main text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_app_admin() then
    raise exception 'only admins can merge events' using errcode = '42501';
  end if;
  if duplicate = main
    or not exists (select 1 from public.events e where e.id = duplicate and e.status <> 'merged')
    or not exists (select 1 from public.events e where e.id = main and e.status <> 'merged')
  then
    raise exception 'pick two different events' using errcode = '22023';
  end if;

  insert into public.attendances as a (profile_id, event_id, source, status, role, created_at)
  select d.profile_id, main, d.source, d.status, d.role, d.created_at
  from public.attendances d where d.event_id = duplicate
  on conflict (profile_id, event_id) do update set
    status = case
      when a.status = 'confirmed' or excluded.status = 'confirmed' then 'confirmed'
      when a.status = 'dismissed' or excluded.status = 'dismissed' then 'dismissed'
      else 'pending'
    end,
    role = case when a.role = 'organizer' or excluded.role = 'organizer' then 'organizer' else 'attendee' end;
  delete from public.attendances d where d.event_id = duplicate;

  insert into public.event_guests as g (event_id, person_id, is_host, first_seen_at, last_seen_at)
  select main, d.person_id, d.is_host, d.first_seen_at, d.last_seen_at
  from public.event_guests d where d.event_id = duplicate
  on conflict (event_id, person_id) do update set is_host = g.is_host or excluded.is_host;
  delete from public.event_guests d where d.event_id = duplicate;

  update public.events set status = 'merged', duplicate_of = main where id = duplicate;
  update public.events set duplicate_of = null where id = main and duplicate_of = duplicate;
end;
$$;

-- Phase A coverage: guests with a handle against Luma's guest_count.
create function public.ingest_coverage()
returns table (synced_events integer, guest_total bigint, with_handle bigint, coverage numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_app_admin() then
    raise exception 'only admins can see the coverage' using errcode = '42501';
  end if;
  return query
  select count(*)::integer,
    coalesce(sum(e.guest_count), 0)::bigint,
    coalesce(sum(c.n), 0)::bigint,
    case when sum(e.guest_count) > 0 then round(sum(c.n)::numeric / sum(e.guest_count), 3) end
  from public.events e
  cross join lateral (select count(*) as n from public.event_guests g where g.event_id = e.id) c
  where e.external_kind = 'luma' and e.guests_synced_at is not null;
end;
$$;

-- ───────── Ingestion (service role only) ─────────

-- Inserts or updates one imported event by (external_kind, external_id).
-- payload: external_kind, external_id, org_id, source_id, id_base, name,
-- short, starts_at, ends_at, url, city, country, guest_count, canceled.
-- city: a key with null means "there is a place but it is not a known
-- Spanish city"; no key means the feed says nothing about the place.
-- An event of another organization is never touched: the caller may only
-- be allowed to write to org_id.
create function public.ingest_event(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_kind     text := payload ->> 'external_kind';
  v_ext      text := payload ->> 'external_id';
  v_org      text := payload ->> 'org_id';
  v_abroad   boolean;
  v_place_ok boolean;
  v_name     text := left(btrim(payload ->> 'name'), 120);
  v_starts   timestamptz := (payload ->> 'starts_at')::timestamptz;
  v_ends     timestamptz := nullif(payload ->> 'ends_at', '')::timestamptz;
  v_from     date;
  v_to       date;
  v_city     text := nullif(btrim(payload ->> 'city'), '');
  v_country  text := nullif(payload ->> 'country', '');
  v_source   uuid := nullif(payload ->> 'source_id', '')::uuid;
  v_canceled boolean := coalesce((payload ->> 'canceled')::boolean, false);
  v_guests   integer := nullif(payload ->> 'guest_count', '')::integer;
  v_url      text := nullif(payload ->> 'url', '');
  v_found    public.events;
  v_twin     public.events;
  v_dup      text;
  v_status   text;
  v_base     text;
  v_id       text;
  v_n        integer := 1;
  v_changed  integer;
begin
  if v_kind is null or v_ext is null or v_org is null or coalesce(v_name, '') = '' or v_starts is null then
    raise exception 'ingest_event needs external_kind, external_id, org_id, name and starts_at' using errcode = '22023';
  end if;
  v_abroad := coalesce(v_country, 'ES') <> 'ES';
  v_from := (v_starts at time zone 'Europe/Madrid')::date;
  v_to := (v_ends at time zone 'Europe/Madrid')::date;
  if v_to is not null and v_to <= v_from then
    v_to := null;
  end if;

  select * into v_found from public.events e where e.external_kind = v_kind and e.external_id = v_ext;
  if found then
    if v_found.org_id <> v_org then
      return jsonb_build_object('id', v_found.id, 'action', 'skipped', 'status', v_found.status, 'reason', 'other_org');
    end if;
    if v_found.status = 'merged' then
      return jsonb_build_object('id', v_found.id, 'action', 'skipped', 'status', 'merged');
    end if;
    -- An unresolved city keeps the stored one (it may have been fixed by
    -- hand) but is not enough to publish again a canceled event.
    v_place_ok := not v_abroad and coalesce(v_city, nullif(v_found.city, '')) is not null
      and not (payload ? 'city' and v_city is null);
    v_status := case
      when v_canceled then 'canceled'
      when v_found.status = 'published' and v_abroad then 'draft'   -- moved out of Spain
      when v_found.status = 'canceled' then
        case when v_found.source_id is not null and v_found.duplicate_of is null and v_place_ok
          then 'published' else 'draft' end
      else v_found.status
    end;
    update public.events e set
      name = v_name, starts_at = v_starts, ends_at = v_ends, starts_on = v_from, ends_on = v_to,
      url = coalesce(v_url, e.url), city = coalesce(v_city, e.city),
      source_id = coalesce(v_source, e.source_id), guest_count = coalesce(v_guests, e.guest_count),
      status = v_status
    where e.id = v_found.id
      and (e.name, e.starts_at, e.ends_at, e.starts_on, e.ends_on, e.url, e.city, e.source_id, e.guest_count, e.status)
        is distinct from
          (v_name, v_starts, v_ends, v_from, v_to, coalesce(v_url, e.url), coalesce(v_city, e.city),
           coalesce(v_source, e.source_id), coalesce(v_guests, e.guest_count), v_status);
    get diagnostics v_changed = row_count;
    update public.events e set synced_at = now() where e.id = v_found.id;
    return jsonb_build_object('id', v_found.id, 'action', case when v_changed > 0 then 'updated' else 'unchanged' end,
      'status', v_status);
  end if;

  -- Possible duplicate: same day, same city, similar name. Luma wins over a
  -- Meetup copy of the same organization; across organizations the newcomer
  -- waits as a draft and the existing event is left alone.
  if v_city is not null then
    select d.* into v_twin from public.events d
    where d.starts_on = v_from and lower(d.city) = lower(v_city)
      and d.status in ('draft', 'published') and d.duplicate_of is null
      and extensions.similarity(lower(d.name), lower(v_name)) >= 0.5
    order by extensions.similarity(lower(d.name), lower(v_name)) desc
    limit 1;
  end if;
  if v_twin.id is not null
    and not (v_kind = 'luma' and v_twin.external_kind is not distinct from 'meetup' and v_twin.org_id = v_org)
  then
    v_dup := v_twin.id;
  end if;

  v_status := case
    when v_canceled then 'canceled'
    when v_source is null or v_city is null or v_abroad or v_dup is not null then 'draft'
    else 'published'
  end;

  v_base := rtrim(left(coalesce(nullif(payload ->> 'id_base', ''), ''), 44), '-');
  if v_base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    v_base := 'evento-' || to_char(v_from, 'YY');
  end if;
  v_id := v_base;
  while exists (select 1 from public.events e where e.id = v_id) loop
    v_n := v_n + 1;
    v_id := v_base || '-' || v_n;
  end loop;

  insert into public.events (id, org_id, name, short, city, starts_on, ends_on, url, kind, color,
    source_id, external_kind, external_id, status, starts_at, ends_at, guest_count, duplicate_of, synced_at)
  values (
    v_id, v_org, v_name,
    left(coalesce(nullif(btrim(payload ->> 'short'), ''), v_name), 30),
    coalesce(v_city, ''), v_from, v_to, v_url, 'Meetup',
    coalesce((select x.color from public.events x where x.org_id = v_org order by x.starts_on desc limit 1), '#111113'),
    v_source, v_kind, v_ext, v_status, v_starts, v_ends, v_guests, v_dup, now()
  );

  if v_twin.id is not null and v_dup is null then
    update public.events set status = 'draft', duplicate_of = v_id
    where id = v_twin.id and org_id = v_org and status in ('draft', 'published');
  end if;

  return jsonb_build_object('id', v_id, 'action', 'created', 'status', v_status, 'duplicate_of', v_dup);
end;
$$;

-- Events of a source that are no longer listed before they happen. Only
-- called after a complete read of the source (an empty one included).
create function public.cancel_missing_events(target_source uuid, seen text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update public.events e set status = 'canceled'
  where e.source_id = target_source
    and e.external_id <> all (seen)
    and e.starts_at > now()
    and e.status in ('draft', 'published');
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- Stores the guests read from Luma for one event and links them.
-- guests: [{ luma_user_id, handle, name, avatar_url, is_host }]
create function public.ingest_guests(target_event text, guests jsonb, total integer, full_list boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ev public.events;
  g jsonb;
  person uuid;
  kept uuid[] := '{}';
  stored integer := 0;
  linked integer;
begin
  select * into ev from public.events e where e.id = target_event;
  if not found then
    raise exception 'event not found' using errcode = '22023';
  end if;
  for g in select value from jsonb_array_elements(coalesce(guests, '[]'::jsonb)) loop
    continue when coalesce(g ->> 'handle', '') !~ '^[a-z0-9_]{1,15}$' or coalesce(g ->> 'luma_user_id', '') = '';
    continue when exists (select 1 from public.suppressed_handles s where s.handle = g ->> 'handle');
    insert into public.external_people as p (luma_user_id, handle, name, avatar_url, last_seen_on)
    values (g ->> 'luma_user_id', g ->> 'handle', left(coalesce(g ->> 'name', ''), 80), g ->> 'avatar_url', ev.starts_on)
    on conflict (luma_user_id) do update set
      handle = excluded.handle, name = excluded.name, avatar_url = excluded.avatar_url,
      last_seen_on = greatest(p.last_seen_on, excluded.last_seen_on), updated_at = now()
    returning p.id into person;
    insert into public.event_guests as eg (event_id, person_id, is_host)
    values (target_event, person, coalesce((g ->> 'is_host')::boolean, false))
    on conflict (event_id, person_id) do update set last_seen_at = now(), is_host = eg.is_host or excluded.is_host;
    kept := kept || person;
    stored := stored + 1;
  end loop;
  -- Phase B only: whoever left the full list unregistered.
  if full_list then
    delete from public.event_guests eg where eg.event_id = target_event and not (eg.person_id = any (kept));
  end if;
  update public.events e set guest_count = coalesce(total, e.guest_count), guests_synced_at = now()
  where e.id = target_event;
  linked := public.link_external_people(null, target_event);
  return jsonb_build_object('stored', stored, 'linked', linked);
end;
$$;

-- One slot to call Luma. The row lock makes every caller (cron runs and
-- manual syncs at the same time) wait its turn, so together they never go
-- over one request per gap_ms.
create function public.luma_slot(gap_ms integer default 1000) returns void
language plpgsql security definer set search_path = '' as $$
declare
  last_at timestamptz;
  pause double precision;
begin
  select (s.value #>> '{}')::timestamptz into last_at
  from public.app_settings s where s.key = 'luma_last_request' for update;
  pause := gap_ms / 1000.0 - extract(epoch from clock_timestamp() - coalesce(last_at, '-infinity'));
  if pause > 0 then
    perform pg_sleep(least(pause, 5));
  end if;
  update public.app_settings set value = to_jsonb(clock_timestamp()::text) where key = 'luma_last_request';
end;
$$;

-- Monthly cleanup (scheduled in 20261013130000_ingest_cron.sql).
create function public.run_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  started timestamptz := now();
  people integer;
  runs integer;
begin
  delete from public.external_people p
  where p.profile_id is null and p.last_seen_on < current_date - interval '12 months';
  get diagnostics people = row_count;
  delete from public.sync_runs r where r.started_at < now() - interval '90 days';
  get diagnostics runs = row_count;
  insert into public.sync_runs (job, started_at, finished_at, ok, stats)
  values ('retention', started, now(), true, jsonb_build_object('people_deleted', people, 'runs_deleted', runs));
  return jsonb_build_object('people_deleted', people, 'runs_deleted', runs);
end;
$$;

-- ───────── Function privileges ─────────

revoke all on function
  public.verified_handle(uuid),
  public.link_external_people(uuid, text),
  public.ingest_event(jsonb),
  public.cancel_missing_events(uuid, text[]),
  public.ingest_guests(text, jsonb, integer, boolean),
  public.luma_slot(integer),
  public.run_retention()
from public, anon, authenticated;
grant execute on function
  public.verified_handle(uuid),
  public.link_external_people(uuid, text),
  public.ingest_event(jsonb),
  public.cancel_missing_events(uuid, text[]),
  public.ingest_guests(text, jsonb, integer, boolean),
  public.luma_slot(integer),
  public.run_retention()
to service_role;

revoke all on function
  public.claim_detected_attendances(),
  public.set_attendance(text, boolean),
  public.review_detected(text[], boolean),
  public.event_shadows(),
  public.hide_me(boolean),
  public.merge_events(text, text),
  public.ingest_coverage()
from public, anon;
grant execute on function
  public.claim_detected_attendances(),
  public.set_attendance(text, boolean),
  public.review_detected(text[], boolean),
  public.event_shadows(),
  public.hide_me(boolean),
  public.merge_events(text, text),
  public.ingest_coverage()
to authenticated;
