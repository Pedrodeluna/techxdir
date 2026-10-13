# Plan de implementación · Ingesta automática de eventos y asistentes

Este plan aplica `docs/spec-auto-ingest.md`. Todo se hace en la rama `feat/auto-ingest`, con un commit por paso. Cada paso indica los archivos y el código exacto.

## 0. Resumen

| Paso | Commit | Archivos |
| --- | --- | --- |
| 1 | `feat(db): modelo de datos de la ingesta automática` | `supabase/migrations/20261013120000_auto_ingest.sql` |
| 2 | `test(db): pruebas SQL de la ingesta y el cruce` | `supabase/tests/auto_ingest.sql` |
| 3 | `feat(functions): módulos compartidos de Luma, iCal y ciudades` | `supabase/functions/_shared/{cors,auth,luma,ical,cities,ingest}.ts`, sus `_test.ts`, `supabase/functions/deno.json` |
| 4 | `feat(functions): sync-sources, sync-guests y add-url` | `supabase/functions/{sync-sources,sync-guests,add-url}/index.ts`, `supabase/config.toml`, `supabase/functions/.env.example` |
| 5 | `feat(db): programación con pg_cron` | `supabase/migrations/20261013130000_ingest_cron.sql` |
| 6 | `feat(web): asistencias confirmadas, pendientes y personas sombra` | `web/src/data/sample.ts`, `web/src/features/events/catalog.ts`, `web/src/features/badge/{people.ts,model.ts,useBadgeStore.ts}`, `scripts/test-people.mjs` |
| 7 | `feat(web): aviso de eventos detectados y sombras en el evento` | `web/src/features/badge/DetectedEvents.tsx`, `BadgeApp.tsx`, `panels/EventsPanel.tsx`, `panels/PeoplePanel.tsx`, `web/src/styles/badge.css` |
| 8 | `feat(web): página de privacidad y "Ocultarme"` | `web/src/pages/Privacy.tsx`, `web/src/pages/privacy.css`, `web/src/pages/AuthCallback.tsx`, `web/src/App.tsx`, `web/src/pages/Landing.tsx`, `BadgeApp.tsx` |
| 9 | `feat(admin): fuentes, sincronización y revisión de eventos importados` | `web/src/features/sources/{api.ts,SourceManager.tsx,sources.css}`, `web/src/pages/admin/{SourcesSection,SyncSection,EventsSection}.tsx`, `context.ts`, `Admin.tsx`, `App.tsx`, `Organizations.tsx` |
| 10 | `docs: README y datos locales de la ingesta` | `README.md`, `scripts/seed-local-ingest.sql` |

### Desviaciones de la especificación

- **Estado `merged`.** "Fusionar" no borra el duplicado. Lo deja en `status='merged'`. Si se borrara, la siguiente sincronización de Meetup lo volvería a crear. Un evento `merged` no se muestra y la sincronización no lo toca.
- **`event_guests.is_host`.** Sirve para asignar `role='organizer'` al confirmar un host que gestiona la organización (spec 8.4).
- **Etiqueta de las sombras: "Visto en Luma".** Una sombra puede ser alguien sin cuenta o un usuario que todavía no ha confirmado. "No está en la app" sería falso en el segundo caso.
- **"¿Eres tú?"** Solo ve sombras quien tiene sesión, y su propia sombra se filtra (`is_me`). Por eso el enlace lleva a `/privacidad#ocultarme`. El cruce al entrar con X ya es automático (`claim_detected_attendances`).
- **Retención.** Es una función SQL (`run_retention()`) que lanza `pg_cron` directamente, no una Edge Function. No necesita red.
- **Presupuesto de tiempo.** Las Edge Functions tienen un límite de tiempo de ejecución. Por eso cada ejecución procesa lo que cabe en 110 s y deja el resto para la siguiente:
  - `sync-sources` se lanza cada hora de 04:00 a 07:00 UTC. Solo procesa las fuentes no sincronizadas en las últimas 20 h.
  - `sync-guests` se lanza cada hora. Solo procesa los eventos no leídos en las últimas 6 h.
- **Descubrimiento.** Usa las páginas de ciudad de Madrid y Barcelona (`discover_place_api_id` comprobados). La "bola de nieve" de calendarios de hosts queda fuera, porque Luma no expone de forma pública los calendarios de un usuario.
- **Fase B.** No se implementa. Si `luma_full_list_enabled` está activo, `sync-guests` lo indica en sus estadísticas y sigue con la Fase A.
- **Asistencias.** La acreditación ya no inserta ni borra filas de `attendances` directamente. Usa la RPC `set_attendance`, que respeta los descartes.

### Orden y dependencias

- Los pasos 1 y 2 van juntos: el test valida la migración.
- Los pasos 3 y 4 dependen del 1 (nombres de las RPC).
- El paso 5 depende del 4.
- Los pasos 6 a 9 dependen del 1.
- Los pasos 6 a 8 son independientes del 9 y se pueden implementar en paralelo.

---

## Paso 1 · Migración del modelo de datos

**Archivo nuevo:** `supabase/migrations/20261013120000_auto_ingest.sql`

```sql
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
  ('luma_full_list_enabled', 'false'::jsonb);

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
create function public.link_external_people(only_profile uuid default null, only_event text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare added integer;
begin
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

-- Luma guests without confirmed or dismissed attendance, for signed-in
-- people only. The public badge pages never call this.
create function public.event_shadows()
returns table (event_id text, person_id uuid, handle text, name text, avatar_url text, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select g.event_id, p.id, p.handle, p.name, p.avatar_url, coalesce(p.profile_id = (select auth.uid()), false)
  from public.event_guests g
  join public.external_people p on p.id = g.person_id
  join public.events e on e.id = g.event_id and e.status = 'published'
  where (select auth.uid()) is not null
    and not exists (
      select 1 from public.attendances a
      where a.profile_id = p.profile_id and a.event_id = g.event_id and a.status in ('confirmed', 'dismissed')
    )
    and not exists (select 1 from public.suppressed_handles s where s.handle = p.handle)
  order by g.event_id, p.id;
$$;

-- "Ocultarme": needs a verified X handle. Suppresses it for good, deletes
-- what was imported about it and, if asked, the account too.
create function public.hide_me(delete_account boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  h text := public.verified_handle((select auth.uid()));
begin
  if me is null or h is null or h !~ '^[a-z0-9_]{1,15}$' then
    raise exception 'sign in with X to hide your handle' using errcode = '42501';
  end if;
  insert into public.suppressed_handles (handle) values (h) on conflict do nothing;
  delete from public.attendances a where a.profile_id = me and a.source = 'luma' and a.status <> 'confirmed';
  delete from public.external_people p where p.handle = h or p.profile_id = me;
  if delete_account then
    delete from auth.users u where u.id = me;
  end if;
end;
$$;

-- ───────── Admin review ─────────

-- Moves attendance and guests of a duplicate to the main event. The best
-- status wins: confirmed, then pending, then dismissed.
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
      when a.status = 'pending' or excluded.status = 'pending' then 'pending'
      else 'dismissed'
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
create function public.ingest_event(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_kind     text := payload ->> 'external_kind';
  v_ext      text := payload ->> 'external_id';
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
  if v_kind is null or v_ext is null or coalesce(v_name, '') = '' or v_starts is null then
    raise exception 'ingest_event needs external_kind, external_id, name and starts_at' using errcode = '22023';
  end if;
  v_from := (v_starts at time zone 'Europe/Madrid')::date;
  v_to := (v_ends at time zone 'Europe/Madrid')::date;
  if v_to is not null and v_to <= v_from then
    v_to := null;
  end if;

  select * into v_found from public.events e where e.external_kind = v_kind and e.external_id = v_ext;
  if found then
    if v_found.status = 'merged' then
      return jsonb_build_object('id', v_found.id, 'action', 'skipped', 'status', 'merged');
    end if;
    v_status := case
      when v_canceled then 'canceled'
      when v_found.status = 'canceled' then
        case when v_found.source_id is not null and v_found.duplicate_of is null and coalesce(v_city, v_found.city) <> ''
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
    return jsonb_build_object('id', v_found.id, 'action', case when v_changed > 0 then 'updated' else 'unchanged' end,
      'status', v_status);
  end if;

  -- Possible duplicate: same day, same city, similar name. Luma wins over Meetup.
  if v_city is not null then
    select d.* into v_twin from public.events d
    where d.starts_on = v_from and lower(d.city) = lower(v_city)
      and d.status in ('draft', 'published') and d.duplicate_of is null
      and extensions.similarity(lower(d.name), lower(v_name)) >= 0.5
    order by extensions.similarity(lower(d.name), lower(v_name)) desc
    limit 1;
  end if;
  if v_twin.id is not null and not (v_kind = 'luma' and v_twin.external_kind is not distinct from 'meetup') then
    v_dup := v_twin.id;
  end if;

  v_status := case
    when v_canceled then 'canceled'
    when v_source is null or v_city is null or coalesce(v_country, 'ES') <> 'ES' or v_dup is not null then 'draft'
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
    source_id, external_kind, external_id, status, starts_at, ends_at, guest_count, duplicate_of)
  values (
    v_id, payload ->> 'org_id', v_name,
    left(coalesce(nullif(btrim(payload ->> 'short'), ''), v_name), 30),
    coalesce(v_city, ''), v_from, v_to, v_url, 'Meetup',
    coalesce((select x.color from public.events x where x.org_id = payload ->> 'org_id' order by x.starts_on desc limit 1), '#111113'),
    v_source, v_kind, v_ext, v_status, v_starts, v_ends, v_guests, v_dup
  );

  if v_twin.id is not null and v_dup is null then
    update public.events set status = 'draft', duplicate_of = v_id
    where id = v_twin.id and status in ('draft', 'published');
  end if;

  return jsonb_build_object('id', v_id, 'action', 'created', 'status', v_status, 'duplicate_of', v_dup);
end;
$$;

-- Events of a source that are no longer listed before they happen.
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
  public.run_retention()
from public, anon, authenticated;
grant execute on function
  public.verified_handle(uuid),
  public.link_external_people(uuid, text),
  public.ingest_event(jsonb),
  public.cancel_missing_events(uuid, text[]),
  public.ingest_guests(text, jsonb, integer, boolean),
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
```

**Notas:**

- `guard_event_review` no es `security definer`. Así `current_user` es el rol del cliente. Dentro de `merge_events`, que sí lo es, `current_user` es el propietario y el guardia no actúa (el mismo patrón que `keep_one_manager`).
- `events.city` sigue siendo `not null`. Los eventos importados sin ciudad se guardan con `''` y en `draft`.
- La comprobación es `similarity(lower(d.name), lower(v_name)) >= 0.5` sobre los eventos del mismo día. El índice de `starts_on` ya acota bien la búsqueda, así que no hace falta un índice trigram.

**Verificación:** `supabase db reset`. Debe terminar sin errores.

---

## Paso 2 · Pruebas SQL

**Archivo nuevo:** `supabase/tests/auto_ingest.sql`. Sigue el patrón de `admin_panel.sql`: los fixtures van en una transacción que termina en `rollback`, y el rol cambia con `set local role`.

```sql
-- Run against a fresh local stack: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/auto_ingest.sql
-- All fixtures and changes roll back.
begin;

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
insert into public.orgs (id, name) values ('test-ingest-org', 'Ingest test org');
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

-- Another signed-in person does not see pending attendance of others.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000094', true);
do $$ begin
  if exists (select 1 from public.attendances where status <> 'confirmed') then
    raise exception 'pending attendance of others is visible';
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
  -- "Ocultarme": suppresses the handle and deletes what was imported.
  perform public.hide_me(false);
  if not exists (select 1 from public.suppressed_handles where handle = 'ti_other')
    or exists (select 1 from public.event_shadows() where handle = 'ti_other') then
    raise exception 'hide_me did not suppress the handle';
  end if;
end $$;

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
  if (select synced_events from public.ingest_coverage()) <> 1 then
    raise exception 'coverage does not count the synced event';
  end if;
end $$;

rollback;
```

**Verificación:**

```sh
supabase db reset
DB_URL=$(supabase status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')
for f in supabase/tests/*.sql; do psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f" || exit 1; done
```

Las pruebas anteriores (`admin_panel.sql`, `org_admins.sql`, `org_deletion.sql`) deben seguir pasando. Insertan eventos sin `status`, que por defecto es `published`.

---

## Paso 3 · Módulos compartidos de las Edge Functions

### 3.1 `supabase/functions/_shared/cors.ts` (modificar)

Hay que permitir `POST`.

```diff
-  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
+  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
```

### 3.2 `supabase/functions/deno.json` (modificar)

```diff
-    "test": "deno test profile/"
+    "test": "deno test profile/ _shared/"
```

### 3.3 `supabase/functions/_shared/cities.ts` (nuevo)

```ts
// Canonical names of the Spanish cities the app groups events by, so that
// "Barcelona, Catalunya", "BCN" and "barcelona" end up as one city.
const CITIES: Record<string, string[]> = {
  'Madrid': ['madrid'],
  'Barcelona': ['barcelona', 'bcn'],
  'Valencia': ['valencia', 'valència'],
  'Sevilla': ['sevilla', 'seville'],
  'Málaga': ['malaga', 'málaga'],
  'Bilbao': ['bilbao', 'bilbo'],
  'Zaragoza': ['zaragoza'],
  'Alicante': ['alicante', 'alacant'],
  'Granada': ['granada'],
  'A Coruña': ['a coruña', 'a coruna', 'la coruña', 'coruña'],
  'Vigo': ['vigo'],
  'Valladolid': ['valladolid'],
  'Murcia': ['murcia'],
  'Palma': ['palma', 'palma de mallorca'],
  'Las Palmas': ['las palmas', 'las palmas de gran canaria'],
  'Santa Cruz de Tenerife': ['santa cruz de tenerife', 'tenerife'],
  'San Sebastián': ['san sebastián', 'san sebastian', 'donostia', 'donostia-san sebastián'],
  'Pamplona': ['pamplona', 'iruña'],
  'Oviedo': ['oviedo'],
  'Gijón': ['gijón', 'gijon'],
  'Santander': ['santander'],
  'Córdoba': ['córdoba', 'cordoba'],
  'Salamanca': ['salamanca'],
  'Logroño': ['logroño', 'logrono'],
  'Castellón': ['castellón', 'castellon', 'castelló', 'castellón de la plana'],
  'Girona': ['girona', 'gerona'],
  'Tarragona': ['tarragona'],
  'Cádiz': ['cádiz', 'cadiz'],
  'Vitoria': ['vitoria', 'vitoria-gasteiz', 'gasteiz'],
  'León': ['león', 'leon'],
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

const BY_ALIAS = new Map<string, string>()
for (const [name, aliases] of Object.entries(CITIES)) {
  for (const alias of aliases) BY_ALIAS.set(fold(alias), name)
}

/** The canonical city for a raw value such as "Barcelona, Catalunya". */
export function normalizeCity(raw: string | null | undefined): string | null {
  if (!raw) return null
  const first = raw.split(',')[0].trim()
  if (!first) return null
  return BY_ALIAS.get(fold(first)) ?? BY_ALIAS.get(fold(raw)) ?? first
}

/** The first known city that appears in free text, such as an iCal LOCATION. */
export function cityFromText(text: string | null | undefined): string | null {
  if (!text) return null
  const parts = text.split(',').map(part => fold(part)).filter(Boolean)
  // Addresses end with the city, so read them backwards.
  for (const part of parts.reverse()) {
    const clean = part.replace(/^\d{5}\s+/, '')
    const hit = BY_ALIAS.get(clean)
    if (hit) return hit
  }
  return null
}
```

### 3.4 `supabase/functions/_shared/ical.ts` (nuevo)

```ts
// Minimal iCalendar (RFC 5545) reader for Meetup group feeds.

export type IcalEvent = {
  uid: string
  summary: string
  url: string | null
  location: string | null
  start: Date
  end: Date | null
  canceled: boolean
}

type Prop = { value: string; params: Record<string, string> }

/** Parses the VEVENT blocks of a feed. Events without UID, SUMMARY or DTSTART are skipped. */
export function parseIcal(text: string): IcalEvent[] {
  // Lines that start with a space or a tab continue the previous one.
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const events: IcalEvent[] = []
  let current: Map<string, Prop> | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = new Map()
      continue
    }
    if (line === 'END:VEVENT') {
      if (current) {
        const event = toEvent(current)
        if (event) events.push(event)
      }
      current = null
      continue
    }
    if (!current) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const [name, ...rawParams] = line.slice(0, colon).split(';')
    const params: Record<string, string> = {}
    for (const p of rawParams) {
      const eq = p.indexOf('=')
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
    }
    current.set(name.toUpperCase(), { value: line.slice(colon + 1), params })
  }
  return events
}

function toEvent(props: Map<string, Prop>): IcalEvent | null {
  const uid = props.get('UID')?.value
  const summary = props.get('SUMMARY')?.value
  const dtstart = props.get('DTSTART')
  if (!uid || !summary || !dtstart) return null
  const start = icalDate(dtstart.value, dtstart.params.TZID)
  if (!start) return null
  const dtend = props.get('DTEND')
  return {
    uid,
    summary: unescape(summary),
    url: props.get('URL')?.value ?? null,
    location: props.has('LOCATION') ? unescape(props.get('LOCATION')!.value) : null,
    start,
    end: dtend ? icalDate(dtend.value, dtend.params.TZID) : null,
    canceled: props.get('STATUS')?.value.toUpperCase() === 'CANCELLED',
  }
}

const unescape = (s: string) =>
  s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim()

/** 20261105T183000Z, 20261105T183000 (+ TZID) or 20261105 (a whole day, read as midnight in the zone). */
export function icalDate(value: string, tzid = 'Europe/Madrid'): Date | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return null
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const
  if (z) return new Date(Date.UTC(...parts))
  return zonedToUtc(parts, tzid)
}

/** The UTC instant of a wall-clock time in an IANA zone. */
export function zonedToUtc(parts: readonly [number, number, number, number, number, number], timeZone: string): Date {
  const guess = Date.UTC(...parts)
  const offset = (at: number) => {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(at))
    const get = (type: string) => Number(f.find(p => p.type === type)!.value)
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - at
  }
  // Two passes settle the offset around daylight saving changes.
  let at = guess - offset(guess)
  at = guess - offset(at)
  return new Date(at)
}
```

### 3.5 `supabase/functions/_shared/luma.ts` (nuevo)

```ts
// Client for Luma's public web endpoints (api.lu.ma), used without a key.
// One request at a time with a pause between them, and retries on 429/5xx.

export const lumaConfig = { gapMs: 1000, retryMs: 2000, base: 'https://api.lu.ma' }

const USER_AGENT = 'techxdir-sync/1.0 (+https://github.com/Pedrodeluna/techxdir)'

export class LumaError extends Error {
  constructor(readonly status: number, path: string) {
    super(`Luma ${status} on ${path}`)
  }
}

let last = 0
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function lumaGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${lumaConfig.base}/${path}?${new URLSearchParams(params)}`
  for (let attempt = 0; ; attempt++) {
    const pause = last + lumaConfig.gapMs - Date.now()
    if (pause > 0) await wait(pause)
    last = Date.now()
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } })
    if (res.ok) return await res.json() as T
    await res.body?.cancel()
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await wait(lumaConfig.retryMs * 2 ** attempt)
      continue
    }
    throw new LumaError(res.status, path)
  }
}

export type LumaPerson = {
  api_id: string
  name?: string | null
  avatar_url?: string | null
  twitter_handle?: string | null
}

export type LumaEvent = {
  api_id: string
  name: string
  start_at: string
  end_at?: string | null
  timezone?: string | null
  url: string
  visibility?: string | null
  geo_address_info?: { city?: string | null; country_code?: string | null; city_state?: string | null } | null
}

export type LumaCalendar = {
  api_id: string
  name: string
  slug?: string | null
  is_personal?: boolean
}

/** One item of a calendar or discovery listing, and the data of /url for an event. */
export type LumaEntry = {
  api_id?: string
  event: LumaEvent
  calendar?: LumaCalendar | null
  guest_count?: number | null
  hosts?: LumaPerson[] | null
  featured_guests?: LumaPerson[] | null
  status?: string | null
}

export type Resolved =
  | { kind: 'event'; data: LumaEntry }
  | { kind: 'calendar'; data: { calendar: LumaCalendar } }

/** The slug of a luma.com / lu.ma URL, or the value itself when it already is one. */
export function lumaSlug(input: string): string | null {
  const value = input.trim()
  if (/^[\w-]+$/.test(value)) return value
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`)
    if (!/(^|\.)(luma\.com|lu\.ma)$/.test(url.hostname)) return null
    const slug = url.pathname.split('/').filter(Boolean)[0]
    return slug && /^[\w-]+$/.test(slug) ? slug : null
  } catch {
    return null
  }
}

export async function resolve(slug: string): Promise<Resolved | null> {
  try {
    const res = await lumaGet<{ kind: string; data: unknown }>('url', { url: slug })
    if (res.kind === 'event' || res.kind === 'calendar') return res as Resolved
    return null
  } catch (error) {
    if (error instanceof LumaError && error.status === 404) return null
    throw error
  }
}

type Page = { entries: LumaEntry[]; has_more?: boolean; next_cursor?: string | null }

async function paginate(path: string, params: Record<string, string>, maxPages: number): Promise<LumaEntry[]> {
  const entries: LumaEntry[] = []
  let cursor: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const res: Page = await lumaGet<Page>(path, {
      ...params,
      pagination_limit: '50',
      ...(cursor ? { pagination_cursor: cursor } : {}),
    })
    entries.push(...(res.entries ?? []))
    cursor = res.next_cursor ?? null
    if (!res.has_more || !cursor) break
  }
  return entries
}

/** Upcoming events of a calendar. Entries already carry hosts, featured guests and guest_count. */
export const calendarEvents = (calendarId: string, maxPages = 10) =>
  paginate('calendar/get-items', { calendar_api_id: calendarId, period: 'future' }, maxPages)

/** Upcoming events of a Luma city page. */
export const discoverEvents = (placeId: string, maxPages = 3) =>
  paginate('discover/get-paginated-events', { discover_place_api_id: placeId }, maxPages)

export const DISCOVER_PLACES: { id: string; city: string }[] = [
  { id: 'discplace-03jiEcS4mvwJuDa', city: 'madrid' },
  { id: 'discplace-WcS4REeayDPXV4n', city: 'barcelona' },
]

/** A Luma twitter_handle (sometimes a URL or with @) as a valid lowercase X handle. */
export function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null
  const handle = raw.trim()
    .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
    .toLowerCase()
  return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : null
}

export type Guest = { luma_user_id: string; handle: string; name: string; avatar_url: string | null; is_host: boolean }

/** Hosts and featured guests of an entry that have an X handle, once each. */
export function guestsOf(entry: LumaEntry): Guest[] {
  const seen = new Map<string, Guest>()
  const add = (person: LumaPerson, isHost: boolean) => {
    const handle = normalizeHandle(person.twitter_handle)
    if (!handle || !person.api_id) return
    const known = seen.get(person.api_id)
    if (known) {
      known.is_host ||= isHost
      return
    }
    seen.set(person.api_id, {
      luma_user_id: person.api_id,
      handle,
      name: (person.name ?? '').trim().slice(0, 80),
      avatar_url: person.avatar_url ?? null,
      is_host: isHost,
    })
  }
  for (const host of entry.hosts ?? []) add(host, true)
  for (const guest of entry.featured_guests ?? []) add(guest, false)
  return [...seen.values()]
}
```

### 3.6 `supabase/functions/_shared/auth.ts` (nuevo)

```ts
// Who is calling an ingestion function: the scheduler (x-cron-secret), an
// admin, a manager of the given organization, or nobody allowed.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type Caller =
  | { kind: 'cron' }
  | { kind: 'admin'; userId: string }
  | { kind: 'manager'; userId: string; orgs: string[] }

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Compares two strings in constant time. */
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

export async function authorize(req: Request, db: SupabaseClient): Promise<Caller | null> {
  const secret = Deno.env.get('CRON_SECRET')
  const given = req.headers.get('x-cron-secret')
  if (secret && given && sameSecret(given, secret)) return { kind: 'cron' }

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data: { user } } = await db.auth.getUser(token)
  if (!user) return null

  const [admin, banned, managed] = await Promise.all([
    db.from('app_admins').select('profile_id').eq('profile_id', user.id).maybeSingle(),
    db.from('bans').select('profile_id').eq('profile_id', user.id).maybeSingle(),
    db.from('org_managers').select('org_id').eq('profile_id', user.id),
  ])
  if (banned.data) return null
  if (admin.data) return { kind: 'admin', userId: user.id }
  const orgs = (managed.data ?? []).map(row => row.org_id as string)
  return orgs.length ? { kind: 'manager', userId: user.id, orgs } : null
}

export const canManage = (caller: Caller, orgId: string) =>
  caller.kind !== 'manager' || caller.orgs.includes(orgId)

export const userIdOf = (caller: Caller) => caller.kind === 'cron' ? null : caller.userId
```

### 3.7 `supabase/functions/_shared/ingest.ts` (nuevo)

```ts
// Reads sources and discovery listings and writes them through the
// ingest_* SQL functions. Each run stops when its time budget runs out and
// leaves the rest for the next one.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { cityFromText, normalizeCity } from './cities.ts'
import { type IcalEvent, parseIcal } from './ical.ts'
import { calendarEvents, DISCOVER_PLACES, discoverEvents, type LumaEntry, LumaError, resolve } from './luma.ts'

export const BUDGET_MS = 110_000
export const deadlineFrom = (start = Date.now()) => start + BUDGET_MS

export type Source = {
  id: string
  org_id: string
  kind: 'luma_calendar' | 'meetup_ical'
  url: string
  external_id: string
  country_filter: string | null
}

/** The payload of public.ingest_event(). */
export type EventPayload = {
  external_kind: 'luma' | 'meetup'
  external_id: string
  name: string
  starts_at: string
  ends_at: string | null
  url: string | null
  city: string | null
  country: string | null
  guest_count: number | null
  canceled: boolean
}

export function slugify(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** The date of an instant in Europe/Madrid, as YYYY-MM-DD. */
export const madridDate = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(at)

/** "Noche de IA 2026 · Madrid" on 2026-03-05 → "noche-de-ia-madrid-26". */
export function eventIdBase(name: string, startsAt: string): string {
  const yy = madridDate(new Date(startsAt)).slice(2, 4)
  const words = slugify(name).split('-').filter(word => word && !/^(19|20)\d{2}$/.test(word))
  let base = ''
  for (const word of words) {
    if ((base ? base.length + 1 : 0) + word.length > 40) break
    base = base ? `${base}-${word}` : word
  }
  return `${base || 'evento'}-${yy}`
}

/** A short label for the badge: the name up to 30 characters, cut at a word. */
export function shortName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim()
  if (clean.length <= 30) return clean
  const cut = clean.slice(0, 30)
  const space = cut.lastIndexOf(' ')
  return (space > 12 ? cut.slice(0, space) : cut).replace(/[\s·,:;-]+$/, '')
}

/** "https://www.meetup.com/es-ES/madrid-ai/events/" → "madrid-ai". */
export function meetupGroup(input: string): string | null {
  try {
    const url = new URL(input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`)
    if (!/(^|\.)meetup\.com$/.test(url.hostname)) return null
    const parts = url.pathname.split('/').filter(Boolean)
    const group = /^[a-z]{2}(-[A-Z]{2})?$/.test(parts[0] ?? '') ? parts[1] : parts[0]
    return group && /^[\w-]+$/.test(group) && group !== 'find' ? group : null
  } catch {
    return null
  }
}

export const meetupIcalUrl = (group: string) => `https://www.meetup.com/${group}/events/ical/`

export function fromLuma(entry: LumaEntry): EventPayload {
  const e = entry.event
  const geo = e.geo_address_info ?? {}
  return {
    external_kind: 'luma',
    external_id: e.api_id,
    name: e.name,
    starts_at: e.start_at,
    ends_at: e.end_at ?? null,
    url: `https://luma.com/${e.url}`,
    city: normalizeCity(geo.city ?? geo.city_state ?? null),
    country: geo.country_code?.toUpperCase() ?? null,
    guest_count: typeof entry.guest_count === 'number' ? entry.guest_count : null,
    canceled: entry.status === 'canceled' || entry.status === 'cancelled',
  }
}

export function fromIcal(event: IcalEvent): EventPayload {
  const city = cityFromText(event.location)
  return {
    external_kind: 'meetup',
    external_id: event.uid,
    name: event.summary,
    starts_at: event.start.toISOString(),
    ends_at: event.end?.toISOString() ?? null,
    url: event.url,
    city,
    // Meetup feeds do not carry a country. A known Spanish city is enough;
    // an online or unknown place stays as a draft (city null).
    country: city ? 'ES' : null,
    guest_count: null,
    canceled: event.canceled,
  }
}

async function ingest(db: SupabaseClient, payload: EventPayload, src: { id: string | null; org_id: string }) {
  const { data, error } = await db.rpc('ingest_event', {
    payload: {
      ...payload,
      source_id: src.id,
      org_id: src.org_id,
      id_base: eventIdBase(payload.name, payload.starts_at),
      short: shortName(payload.name),
    },
  })
  if (error) throw new Error(`ingest_event ${payload.external_id}: ${error.message}`)
  return data as { id: string; action: 'created' | 'updated' | 'unchanged' | 'skipped'; status: string }
}

export type SyncStats = { sources: number; created: number; updated: number; canceled: number; errors: string[] }
export const emptyStats = (): SyncStats => ({ sources: 0, created: 0, updated: 0, canceled: 0, errors: [] })

async function readSource(src: Source): Promise<EventPayload[]> {
  if (src.kind === 'luma_calendar') {
    return (await calendarEvents(src.external_id))
      .filter(entry => entry.event?.visibility !== 'private')
      .map(fromLuma)
  }
  const res = await fetch(meetupIcalUrl(src.external_id), {
    headers: { 'User-Agent': 'techxdir-sync/1.0 (+https://github.com/Pedrodeluna/techxdir)' },
  })
  if (!res.ok) throw new Error(`Meetup ${res.status} on ${src.external_id}`)
  return parseIcal(await res.text()).map(fromIcal)
}

/** Reads one source and writes its events. Errors are stored on the source. */
export async function syncSource(db: SupabaseClient, src: Source, stats: SyncStats) {
  stats.sources++
  try {
    const now = Date.now()
    const events = (await readSource(src))
      .filter(e => !src.country_filter || e.country === src.country_filter)
      .filter(e => new Date(e.ends_at ?? e.starts_at).getTime() >= now)
    const seen: string[] = []
    for (const event of events) {
      const result = await ingest(db, event, src)
      seen.push(event.external_id)
      if (result.action === 'created') stats.created++
      if (result.action === 'updated') stats.updated++
    }
    // An empty answer is more likely a hiccup than a calendar with nothing planned.
    if (seen.length) {
      const { data, error } = await db.rpc('cancel_missing_events', { target_source: src.id, seen })
      if (error) throw new Error(error.message)
      stats.canceled += data as number
    }
    await db.from('event_sources').update({ last_synced_at: new Date().toISOString(), last_error: null }).eq('id', src.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stats.errors.push(`${src.url}: ${message}`)
    await db.from('event_sources').update({ last_error: message.slice(0, 500) }).eq('id', src.id)
  }
}

const SOURCE_COLUMNS = 'id, org_id, kind, url, external_id, country_filter'

/** Sources not read in the last 20 hours (or the one asked for), then loose Luma events. */
export async function syncAll(
  db: SupabaseClient,
  opts: { sourceId?: string; force?: boolean; deadline: number },
): Promise<SyncStats & { pending: number }> {
  const stats = emptyStats()
  let query = db.from('event_sources').select(SOURCE_COLUMNS).eq('enabled', true)
  if (opts.sourceId) query = query.eq('id', opts.sourceId)
  else if (!opts.force) {
    query = query.or(`last_synced_at.is.null,last_synced_at.lt.${new Date(Date.now() - 20 * 3600_000).toISOString()}`)
  }
  const { data: sources, error } = await query.order('last_synced_at', { ascending: true, nullsFirst: true })
  if (error) throw new Error(error.message)

  let done = 0
  for (const src of (sources ?? []) as Source[]) {
    if (Date.now() > opts.deadline) break
    await syncSource(db, src, stats)
    done++
  }
  if (!opts.sourceId && Date.now() < opts.deadline) await refreshLooseEvents(db, stats, opts.deadline)
  return { ...stats, pending: (sources?.length ?? 0) - done }
}

/** Luma events added one by one (no source): refreshed one at a time. */
async function refreshLooseEvents(db: SupabaseClient, stats: SyncStats, deadline: number) {
  const { data } = await db.from('events')
    .select('id, org_id, url, external_id')
    .eq('external_kind', 'luma').is('source_id', null)
    .in('status', ['draft', 'published'])
    .gte('starts_on', madridDate(new Date()))
    .order('starts_on').limit(50)
  for (const row of data ?? []) {
    if (Date.now() > deadline) break
    const slug = String(row.url ?? '').split('/').pop()
    if (!slug) continue
    try {
      const found = await resolve(slug)
      if (found?.kind === 'event') {
        const result = await ingest(db, fromLuma(found.data), { id: null, org_id: row.org_id })
        if (result.action === 'updated') stats.updated++
      } else if (!found) {
        await db.from('events').update({ status: 'canceled' }).eq('id', row.id)
        stats.canceled++
      }
    } catch (error) {
      if (!(error instanceof LumaError)) throw error
      stats.errors.push(`${row.id}: ${error.message}`)
    }
  }
}

/** Weekly discovery on the Luma city pages. Only creates suggestions. */
export async function discover(db: SupabaseClient, deadline: number) {
  const stats = { listed: 0, suggested: 0, errors: [] as string[] }
  const [{ data: sources }, { data: known }] = await Promise.all([
    db.from('event_sources').select('external_id').eq('kind', 'luma_calendar'),
    db.from('events').select('external_id').eq('external_kind', 'luma'),
  ])
  const knownCalendars = new Set((sources ?? []).map(s => s.external_id as string))
  const knownEvents = new Set((known ?? []).map(e => e.external_id as string))

  for (const place of DISCOVER_PLACES) {
    if (Date.now() > deadline) break
    let entries: LumaEntry[]
    try {
      entries = await discoverEvents(place.id)
    } catch (error) {
      stats.errors.push(`${place.city}: ${error instanceof Error ? error.message : error}`)
      continue
    }
    stats.listed += entries.length
    const rows = []
    for (const entry of entries) {
      const cal = entry.calendar
      const event = fromLuma(entry)
      if (cal && !cal.is_personal && cal.slug && !knownCalendars.has(cal.api_id)) {
        knownCalendars.add(cal.api_id)
        rows.push({ kind: 'luma_calendar', external_id: cal.api_id, url: `https://luma.com/${cal.slug}`,
          name: cal.name, city: event.city, starts_on: null, found_via: `discover:${place.city}` })
      } else if ((!cal || cal.is_personal) && !knownEvents.has(event.external_id)) {
        rows.push({ kind: 'luma_event', external_id: event.external_id, url: event.url!, name: event.name,
          city: event.city, starts_on: madridDate(new Date(event.starts_at)), found_via: `discover:${place.city}` })
      }
    }
    if (rows.length) {
      const { data, error } = await db.from('import_suggestions')
        .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: true }).select('id')
      if (error) stats.errors.push(error.message)
      else stats.suggested += data?.length ?? 0
    }
  }
  return stats
}

export type Job = 'sources' | 'discover' | 'guests'

export async function startRun(db: SupabaseClient, job: Job): Promise<number | null> {
  const { data } = await db.from('sync_runs').insert({ job }).select('id').single()
  return (data?.id as number | undefined) ?? null
}

export async function finishRun(db: SupabaseClient, id: number | null, stats: unknown, error?: string) {
  if (id === null) return
  await db.from('sync_runs').update({
    finished_at: new Date().toISOString(), ok: !error, stats, error: error ?? null,
  }).eq('id', id)
}
```

### 3.8 Pruebas de los módulos (nuevos)

`supabase/functions/_shared/ical_test.ts`

```ts
import { assertEquals } from 'jsr:@std/assert@1'
import { icalDate, parseIcal } from './ical.ts'

const FEED = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:event_123@meetup.com',
  'SUMMARY:Charla\\, IA y bebidas',
  'DTSTART;TZID=Europe/Madrid:20261105T183000',
  'DTEND;TZID=Europe/Madrid:20261105T203000',
  'LOCATION:Campus\\, Calle de Moreno Nieto 2\\, 28005 Madrid\\, Spain',
  'URL:https://www.meetup.com/madrid-ai/events/123/',
  'DESCRIPTION:Una línea muy larga que se',
  '  parte en dos',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event_124@meetup.com',
  'SUMMARY:Cancelado',
  'DTSTART:20261201T170000Z',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:Sin UID',
  'DTSTART:20261201T170000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

Deno.test('parses events, unescapes text and skips incomplete ones', () => {
  const events = parseIcal(FEED)
  assertEquals(events.length, 2)
  assertEquals(events[0].summary, 'Charla, IA y bebidas')
  assertEquals(events[0].location, 'Campus, Calle de Moreno Nieto 2, 28005 Madrid, Spain')
  assertEquals(events[0].start.toISOString(), '2026-11-05T17:30:00.000Z')
  assertEquals(events[0].canceled, false)
  assertEquals(events[1].canceled, true)
})

Deno.test('reads times in their zone across daylight saving', () => {
  assertEquals(icalDate('20260715T190000', 'Europe/Madrid')?.toISOString(), '2026-07-15T17:00:00.000Z')
  assertEquals(icalDate('20260115T190000', 'Europe/Madrid')?.toISOString(), '2026-01-15T18:00:00.000Z')
  assertEquals(icalDate('20260115T190000Z')?.toISOString(), '2026-01-15T19:00:00.000Z')
  assertEquals(icalDate('nope'), null)
})
```

`supabase/functions/_shared/luma_test.ts`

```ts
import { assertEquals } from 'jsr:@std/assert@1'
import { guestsOf, lumaSlug, normalizeHandle } from './luma.ts'

Deno.test('normalizes X handles from Luma', () => {
  assertEquals(normalizeHandle('@Someone_1'), 'someone_1')
  assertEquals(normalizeHandle('https://x.com/Someone?s=21'), 'someone')
  assertEquals(normalizeHandle('https://twitter.com/someone/'), 'someone')
  assertEquals(normalizeHandle('a handle with spaces'), null)
  assertEquals(normalizeHandle('waytoolonghandle_123'), null)
  assertEquals(normalizeHandle(null), null)
})

Deno.test('extracts the slug of Luma links', () => {
  assertEquals(lumaSlug('https://luma.com/aitinkerers-madrid'), 'aitinkerers-madrid')
  assertEquals(lumaSlug('https://lu.ma/abc123?tk=x'), 'abc123')
  assertEquals(lumaSlug('abc123'), 'abc123')
  assertEquals(lumaSlug('https://example.com/abc123'), null)
})

Deno.test('keeps hosts and featured guests with a handle, once each', () => {
  const event = { api_id: 'evt-1', name: 'E', start_at: '2026-01-01T00:00:00Z', url: 'e' }
  const guests = guestsOf({
    event,
    hosts: [{ api_id: 'usr-1', name: 'Host', twitter_handle: 'host_x' }],
    featured_guests: [
      { api_id: 'usr-1', name: 'Host', twitter_handle: 'host_x' },
      { api_id: 'usr-2', name: 'Guest', twitter_handle: '@Guest_Y' },
      { api_id: 'usr-3', name: 'No handle', twitter_handle: null },
    ],
  })
  assertEquals(guests.map(g => [g.luma_user_id, g.handle, g.is_host]), [
    ['usr-1', 'host_x', true],
    ['usr-2', 'guest_y', false],
  ])
})
```

`supabase/functions/_shared/ingest_test.ts`

```ts
import { assertEquals } from 'jsr:@std/assert@1'
import { cityFromText, normalizeCity } from './cities.ts'
import { eventIdBase, fromLuma, madridDate, meetupGroup, shortName } from './ingest.ts'

Deno.test('builds readable event ids', () => {
  assertEquals(eventIdBase('Noche de IA 2026 · Madrid', '2026-03-05T18:30:00Z'), 'noche-de-ia-madrid-26')
  assertEquals(eventIdBase('¡!', '2026-12-31T23:30:00Z'), 'evento-27')
})

Deno.test('dates are read in Madrid', () => {
  assertEquals(madridDate(new Date('2026-12-31T23:30:00Z')), '2027-01-01')
})

Deno.test('short names fit the badge', () => {
  assertEquals(shortName('AI Tinkerers Madrid · Noviembre edition'), 'AI Tinkerers Madrid')
  assertEquals(shortName('Corto'), 'Corto')
})

Deno.test('reads Meetup group links', () => {
  assertEquals(meetupGroup('https://www.meetup.com/es-ES/madrid-ai/events/'), 'madrid-ai')
  assertEquals(meetupGroup('meetup.com/madrid-ai'), 'madrid-ai')
  assertEquals(meetupGroup('https://luma.com/x'), null)
})

Deno.test('normalizes cities', () => {
  assertEquals(normalizeCity('Barcelona, Catalunya'), 'Barcelona')
  assertEquals(normalizeCity('Donostia'), 'San Sebastián')
  assertEquals(normalizeCity('Lisboa'), 'Lisboa')
  assertEquals(cityFromText('Campus, Calle de Moreno Nieto 2, 28005 Madrid, Spain'), 'Madrid')
  assertEquals(cityFromText('Online event'), null)
})

Deno.test('maps Luma entries', () => {
  const payload = fromLuma({
    event: {
      api_id: 'evt-1', name: 'E', start_at: '2026-01-01T18:00:00Z', url: 'abc',
      geo_address_info: { city: 'Madrid', country_code: 'es' },
    },
    guest_count: 42,
  })
  assertEquals([payload.url, payload.city, payload.country, payload.guest_count], ['https://luma.com/abc', 'Madrid', 'ES', 42])
})
```

**Verificación:** `cd supabase/functions && deno task test && deno lint _shared/`.

---

## Paso 4 · Edge Functions

### 4.1 `supabase/config.toml` (modificar, después de `[functions.profile]`)

El programador llama a las tres funciones sin JWT. Cada función decide quién puede llamarla (`authorize`).

```toml
[functions.sync-sources]
verify_jwt = false

[functions.sync-guests]
verify_jwt = false

[functions.add-url]
verify_jwt = false
```

### 4.2 `supabase/functions/.env.example` (nuevo)

`supabase functions serve` lo lee como `supabase/functions/.env`, que está ignorado en git.

```sh
# Shared with pg_cron through the vault secret "cron_secret" (see 20261013130000_ingest_cron.sql).
CRON_SECRET=local-cron-secret
```

### 4.3 `supabase/functions/sync-sources/index.ts` (nuevo)

```ts
// sync-sources: imports events from the curated sources, or runs the weekly discovery.
//
//   POST /functions/v1/sync-sources  { job?: 'sources' | 'discover', source_id?: string, force?: boolean }
//
// Called by pg_cron (x-cron-secret), by admins, and by managers for the
// sources of their organizations ("Sincronizar ahora").
import { authorize, canManage, serviceClient } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { deadlineFrom, discover, finishRun, startRun, syncAll } from '../_shared/ingest.ts'

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  const deadline = deadlineFrom()

  const db = serviceClient()
  const caller = await authorize(req, db)
  if (!caller) return json({ error: 'Not allowed' }, 403)

  let body: { job?: string; source_id?: string; force?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    // an empty body runs the default job
  }
  const job = body.job === 'discover' ? 'discover' : 'sources'

  if (job === 'discover' && caller.kind === 'manager') return json({ error: 'Only admins run the discovery' }, 403)
  if (job === 'sources' && caller.kind === 'manager') {
    if (!body.source_id) return json({ error: 'Pick a source' }, 400)
    const { data: src } = await db.from('event_sources').select('org_id').eq('id', body.source_id).maybeSingle()
    if (!src || !canManage(caller, src.org_id)) return json({ error: 'Not allowed' }, 403)
  }

  const run = await startRun(db, job)
  try {
    const stats = job === 'discover'
      ? await discover(db, deadline)
      : await syncAll(db, { sourceId: body.source_id, force: body.force === true, deadline })
    await finishRun(db, run, stats)
    return json(stats)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishRun(db, run, {}, message)
    return json({ error: message }, 500)
  }
})
```

### 4.4 `supabase/functions/sync-guests/index.ts` (nuevo)

```ts
// sync-guests: reads the public guest sample (hosts and featured guests) of
// upcoming Luma events and matches it to verified X handles.
//
//   POST /functions/v1/sync-guests  { event_id?: string }
//
// Called every hour by pg_cron and by admins. An event is read again after
// 6 hours, and one last time a day after it ends; then it is frozen.
import { authorize, serviceClient } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { deadlineFrom, finishRun, fromLuma, startRun } from '../_shared/ingest.ts'
import { guestsOf, LumaError, resolve } from '../_shared/luma.ts'

const HOUR = 3600_000

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  const deadline = deadlineFrom()

  const db = serviceClient()
  const caller = await authorize(req, db)
  if (!caller || caller.kind === 'manager') return json({ error: 'Not allowed' }, 403)

  let body: { event_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    // no body: every event that is due
  }

  const { data: settings } = await db.from('app_settings').select('key, value')
  const setting = (key: string) => settings?.find(s => s.key === key)?.value === true
  if (!setting('guest_ingest_enabled')) return json({ skipped: 'guest_ingest_enabled is off' })

  const run = await startRun(db, 'guests')
  const stats = { events: 0, stored: 0, linked: 0, frozen: 0, pending: 0, errors: [] as string[], notes: [] as string[] }
  if (setting('luma_full_list_enabled')) stats.notes.push('Phase B (full guest list) is not implemented; ran Phase A')

  try {
    let query = db.from('events')
      .select('id, url, starts_at, ends_at, guests_synced_at')
      .eq('external_kind', 'luma').eq('status', 'published').eq('guests_frozen', false)
      .lte('starts_at', new Date(Date.now() + 60 * 24 * HOUR).toISOString())
      .order('guests_synced_at', { ascending: true, nullsFirst: true })
      .limit(500)
    if (body.event_id) query = query.eq('id', body.event_id)
    const { data: events, error } = await query
    if (error) throw new Error(error.message)

    const now = Date.now()
    const due = (events ?? []).filter(e => {
      if (body.event_id || !e.guests_synced_at) return true
      const synced = new Date(e.guests_synced_at).getTime()
      const ended = new Date(e.ends_at ?? e.starts_at).getTime()
      if (now > ended + 24 * HOUR) return synced < ended + 24 * HOUR
      return now - synced > 6 * HOUR
    })

    for (const [i, event] of due.entries()) {
      if (Date.now() > deadline) {
        stats.pending = due.length - i
        break
      }
      const ended = new Date(event.ends_at ?? event.starts_at).getTime()
      const last = Date.now() > ended + 24 * HOUR
      try {
        const slug = String(event.url ?? '').split('/').pop()!
        const found = await resolve(slug)
        if (found?.kind !== 'event') {
          stats.errors.push(`${event.id}: not found on Luma`)
          continue
        }
        const { data, error } = await db.rpc('ingest_guests', {
          target_event: event.id,
          guests: guestsOf(found.data),
          total: fromLuma(found.data).guest_count,
          full_list: false,
        })
        if (error) throw new Error(error.message)
        stats.events++
        stats.stored += data.stored
        stats.linked += data.linked
        if (last) {
          await db.from('events').update({ guests_frozen: true }).eq('id', event.id)
          stats.frozen++
        }
      } catch (error) {
        if (!(error instanceof LumaError) && !(error instanceof Error)) throw error
        stats.errors.push(`${event.id}: ${error.message}`)
      }
    }
    await finishRun(db, run, stats)
    return json(stats)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishRun(db, run, stats, message)
    return json({ error: message }, 500)
  }
})
```

### 4.5 `supabase/functions/add-url/index.ts` (nuevo)

```ts
// add-url: "Añadir por URL". A Luma calendar or a Meetup group becomes a
// source and is read at once. A single Luma event is imported as a draft.
//
//   POST /functions/v1/add-url
//   { url: string, org_id?: string, new_org?: string, country_filter?: 'ES' | null }
//
// Admins can add to any organization and create one (new_org); managers
// only add to the organizations they run.
import { authorize, canManage, serviceClient, userIdOf } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { emptyStats, fromLuma, eventIdBase, meetupGroup, meetupIcalUrl, shortName, slugify,
  type Source, syncSource } from '../_shared/ingest.ts'
import { lumaSlug, resolve } from '../_shared/luma.ts'

type Body = { url?: unknown; org_id?: unknown; new_org?: unknown; country_filter?: unknown }

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const db = serviceClient()
  const caller = await authorize(req, db)
  if (!caller || caller.kind === 'cron') return json({ error: 'Not allowed' }, 403)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be valid JSON' }, 400)
  }
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url || url.length > 300) return json({ error: 'Pega un enlace de Luma o Meetup' }, 400)
  const countryFilter = body.country_filter === 'ES' ? 'ES' : null
  const newOrg = typeof body.new_org === 'string' ? body.new_org.trim().slice(0, 80) : ''
  let orgId = typeof body.org_id === 'string' ? body.org_id : ''
  if (!newOrg && !orgId) return json({ error: 'Elige una organización' }, 400)
  if (newOrg && caller.kind !== 'admin') return json({ error: 'Solo un admin crea organizaciones' }, 403)
  if (orgId && !canManage(caller, orgId)) return json({ error: 'No gestionas esa organización' }, 403)

  // What is behind the link?
  let source: Omit<Source, 'id' | 'org_id'> & { name: string }
  const group = meetupGroup(url)
  const slug = group ? null : lumaSlug(url)
  if (group) {
    const res = await fetch(meetupIcalUrl(group), { method: 'GET' })
    await res.body?.cancel()
    if (!res.ok) return json({ error: 'No encontramos ese grupo de Meetup' }, 404)
    source = { kind: 'meetup_ical', url: `https://www.meetup.com/${group}/`, external_id: group,
      name: group, country_filter: countryFilter }
  } else if (slug) {
    const found = await resolve(slug)
    if (!found) return json({ error: 'No encontramos ese enlace en Luma' }, 404)
    if (found.kind === 'event') {
      if (!orgId) return json({ error: 'Elige una organización para el evento' }, 400)
      const payload = fromLuma(found.data)
      const { data, error } = await db.rpc('ingest_event', {
        payload: { ...payload, source_id: null, org_id: orgId,
          id_base: eventIdBase(payload.name, payload.starts_at), short: shortName(payload.name) },
      })
      if (error) return json({ error: error.message }, 500)
      await db.from('import_suggestions').update({ status: 'accepted' }).eq('external_id', payload.external_id)
      return json({ kind: 'event', event: data })
    }
    const cal = found.data.calendar
    source = { kind: 'luma_calendar', url: `https://luma.com/${cal.slug ?? slug}`, external_id: cal.api_id,
      name: cal.name, country_filter: countryFilter }
  } else {
    return json({ error: 'Solo admitimos enlaces de luma.com y meetup.com' }, 400)
  }

  const { data: existing } = await db.from('event_sources').select('id, org_id')
    .eq('kind', source.kind).eq('external_id', source.external_id).maybeSingle()
  if (existing) return json({ error: 'Esa fuente ya está añadida', source_id: existing.id }, 409)

  if (newOrg) {
    const base = slugify(newOrg).slice(0, 40) || 'org'
    let id = base
    for (let n = 2; ; n++) {
      const { data } = await db.from('orgs').select('id').eq('id', id).maybeSingle()
      if (!data) break
      id = `${base}-${n}`
    }
    const { error } = await db.from('orgs').insert({ id, name: newOrg })
    if (error) return json({ error: error.message }, 500)
    orgId = id
  }

  const { data: created, error } = await db.from('event_sources')
    .insert({ ...source, org_id: orgId, created_by: userIdOf(caller) })
    .select('id, org_id, kind, url, external_id, country_filter, name')
    .single()
  if (error) return json({ error: error.message }, 500)
  await db.from('import_suggestions').update({ status: 'accepted' }).eq('external_id', source.external_id)

  const stats = emptyStats()
  await syncSource(db, created as Source, stats)
  return json({ kind: 'source', source: created, org_id: orgId, stats }, 201)
})
```

**Verificación local** (con `npm run dev:local` en marcha):

```sh
cp supabase/functions/.env.example supabase/functions/.env
curl -s -X POST http://127.0.0.1:55321/functions/v1/sync-sources -H 'x-cron-secret: local-cron-secret' -d '{}'
curl -s -X POST http://127.0.0.1:55321/functions/v1/sync-guests  -H 'x-cron-secret: local-cron-secret' -d '{}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:55321/functions/v1/sync-sources -d '{}'   # 403
```

El puerto de la API sale de `supabase status`.

---

## Paso 5 · Programación con pg_cron

**Archivo nuevo:** `supabase/migrations/20261013130000_ingest_cron.sql`

```sql
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
```

**Verificación:** después de `supabase db reset`, `select jobname, schedule from cron.job` devuelve los 4 trabajos. Para probar la llamada en local:

```sql
select vault.create_secret('http://kong:8000', 'project_url');
select vault.create_secret('local-cron-secret', 'cron_secret');
select public.call_ingest('sync-sources', '{"job":"sources"}');
-- unos segundos después
select status_code, left(content, 200) from net._http_response order by id desc limit 1;
select job, ok, stats from public.sync_runs order by id desc limit 1;
```

---

## Paso 6 · Datos del frontend: asistencias confirmadas, detectadas y sombras

### 6.1 `web/src/data/sample.ts` (modificar)

```diff
 export interface TechEvent {
   id: string
   org: string
   name: string
   short: string
   city: string
   date: string
   end: string | null
   url: string | null
   kind: string
   color: string
+  /** Asistentes según Luma, incluidos los que no tienen X (solo eventos importados) */
+  guestCount?: number | null
 }

 export interface Person {
   id: string
   name: string
   handle: string
   role: string
   bio: string
   events: string[]
+  /** Visto en la lista pública de Luma, sin asistencia confirmada en la app */
+  shadow?: boolean
+  /** Foto de Luma (solo sombras) */
+  avatar?: string | null
 }
```

### 6.2 `web/src/features/events/catalog.ts` (modificar)

Solo se muestran los eventos publicados. Un admin o un gestor ve los borradores por RLS, pero no deben aparecer en la acreditación.

```diff
-          supabase.from('events').select('id,org_id,name,short,city,starts_on,ends_on,url,kind,color').order('starts_on').abortSignal(controller.signal),
+          supabase.from('events').select('id,org_id,name,short,city,starts_on,ends_on,url,kind,color,guest_count')
+            .eq('status', 'published').order('starts_on').abortSignal(controller.signal),
```

```diff
-          events: events.data.map(e => ({ id: e.id, org: e.org_id, name: e.name, short: e.short, city: e.city, date: e.starts_on, end: e.ends_on, url: e.url, kind: e.kind, color: e.color })),
+          events: events.data.map(e => ({ id: e.id, org: e.org_id, name: e.name, short: e.short, city: e.city, date: e.starts_on, end: e.ends_on, url: e.url, kind: e.kind, color: e.color, guestCount: e.guest_count })),
```

Es la única lectura pública de `events` (`grep -rn "from('events')" web/src`). Las de `/admin` (`Summary`, `OrgsSection`, `EventsSection`) ven todos los estados a propósito.

### 6.3 `web/src/features/badge/people.ts` (reemplazar)

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Person } from '../../data/sample'

type PublicProfile = Pick<Person, 'id' | 'name' | 'role' | 'bio'> & { handle: string | null }
type Attendance = { profile_id: string; event_id: string }
export type ShadowRow = {
  event_id: string; person_id: string; handle: string; name: string; avatar_url: string | null; is_me: boolean
}

export function peopleFromRows(profiles: PublicProfile[], attendances: Attendance[], userId: string): Person[] {
  const events = new Map<string, string[]>()
  for (const row of attendances) {
    const ids = events.get(row.profile_id) ?? []
    ids.push(row.event_id)
    events.set(row.profile_id, ids)
  }
  return profiles.filter(p => p.id !== userId).map(p => ({
    ...p, handle: p.handle ?? '', events: events.get(p.id) ?? [],
  }))
}

/** Invitados de Luma sin asistencia confirmada: una persona por invitado, con todos sus eventos. */
export function shadowsFromRows(rows: ShadowRow[]): Person[] {
  const byPerson = new Map<string, Person>()
  for (const row of rows) {
    if (row.is_me) continue
    const id = `x:${row.person_id}`
    const known = byPerson.get(id)
    if (known) { known.events.push(row.event_id); continue }
    byPerson.set(id, {
      id, name: row.name || `@${row.handle}`, handle: row.handle, role: '', bio: '',
      events: [row.event_id], shadow: true, avatar: row.avatar_url,
    })
  }
  return [...byPerson.values()]
}

// Page everything: PostgREST caps responses, including attendance rows.
export async function loadPeople(client: SupabaseClient, userId: string, signal: AbortSignal): Promise<Person[]> {
  const pageSize = 500
  async function profiles() {
    const rows: PublicProfile[] = []
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.from('profiles').select('id,name,handle,role,bio')
        .neq('id', userId).order('id').range(offset, offset + pageSize - 1).abortSignal(signal)
      if (error) throw error
      rows.push(...data)
      if (data.length < pageSize) return rows
    }
  }
  async function attendances() {
    const rows: Attendance[] = []
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.from('attendances').select('profile_id,event_id')
        .neq('profile_id', userId).eq('status', 'confirmed').order('profile_id').order('event_id')
        .range(offset, offset + pageSize - 1).abortSignal(signal)
      if (error) throw error
      rows.push(...data)
      if (data.length < pageSize) return rows
    }
  }
  async function shadows() {
    const rows: ShadowRow[] = []
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.rpc('event_shadows')
        .range(offset, offset + pageSize - 1).abortSignal(signal)
      if (error) throw error
      rows.push(...(data as ShadowRow[]))
      if (data.length < pageSize) return rows
    }
  }
  const [profileRows, attendanceRows, shadowRows] = await Promise.all([profiles(), attendances(), shadows()])
  return [...peopleFromRows(profileRows, attendanceRows, userId), ...shadowsFromRows(shadowRows)]
}
```

### 6.4 `web/src/features/badge/model.ts` (modificar)

```diff
 export interface BadgeState {
   me: Me
   myEvents: string[]
+  /** Eventos donde Luma te ha visto y que aún no has confirmado ni descartado */
+  detected?: string[]
+  reviewDetected?: (ids: string[], accept: boolean) => Promise<boolean>
   /** Catálogo real con sesión; el ejemplo mantiene sus datos aislados. */
```

`others()` es "el resto de la comunidad". Una sombra con la que no coincides no es comunidad. Solo aparece en `contacts()` y en los eventos.

```diff
 export function others(myEvents: string[], people: Person[] = PEOPLE, catalog?: Catalog): Contact[] {
   const matched = new Set(contacts(myEvents, people, catalog).map(p => p.id))
   return people
-    .filter(p => !matched.has(p.id))
+    .filter(p => !matched.has(p.id) && !p.shadow)
```

### 6.5 `web/src/features/badge/useBadgeStore.ts` (modificar)

Hay tres cambios:

- Al cargar, primero se reclaman las asistencias detectadas (`claim_detected_attendances`, que cruza el handle verificado con Luma). Después se leen las asistencias propias con su estado.
- `update()` usa la RPC `set_attendance`.
- Se añade `reviewDetected`.

Bloque de carga (sustituye el `useEffect` "con sesión"):

```ts
  const [detected, setDetected] = useState<string[]>([])

  // con sesión: el perfil y la asistencia vienen de Supabase
  useEffect(() => {
    if (!userId || !supabase) return
    const client = supabase
    let alive = true
    async function attendance() {
      // Cruza tu X verificado con los invitados de Luma. Si falla, seguimos con lo que haya.
      await client.rpc('claim_detected_attendances').then(() => undefined, () => undefined)
      const { data, error } = await client.from('attendances').select('event_id,status').eq('profile_id', userId!)
      if (error) throw error
      return data as { event_id: string; status: 'pending' | 'confirmed' | 'dismissed' }[]
    }
    Promise.all([getProfile(), attendance()]).then(([profile, rows]) => {
      if (!alive) return
      const next: BadgeState = {
        me: fromProfile(profile, latest.current.me.photo),
        myEvents: rows.filter(a => a.status === 'confirmed').map(a => a.event_id),
      }
      setState(next)
      setDetected(rows.filter(a => a.status === 'pending').map(a => a.event_id))
      write(userKey(userId), next)
      setReady(true)
    }).catch(() => { if (alive) { setProfileError(true); setReady(true) } }) // sin red: seguimos con la copia local
    return () => { alive = false }
  }, [userId])
```

En `update()`:

```diff
     const added = next.myEvents.filter(id => !prev.myEvents.includes(id))
     const removed = prev.myEvents.filter(id => !next.myEvents.includes(id))
-    if (added.length) supabase.from('attendances').insert(added.map(event_id => ({ profile_id: userId, event_id }))).then()
-    if (removed.length) supabase.from('attendances').delete().eq('profile_id', userId).in('event_id', removed).then()
+    const client = supabase
+    for (const id of added) client.rpc('set_attendance', { target_event: id, going: true }).then()
+    for (const id of removed) client.rpc('set_attendance', { target_event: id, going: false }).then()
+    // marcar o quitar un evento detectado también lo resuelve
+    if (added.length || removed.length) setDetected(list => list.filter(id => !added.includes(id) && !removed.includes(id)))
     return saved
```

Nuevo `reviewDetected`, antes del `shown`:

```ts
  /** Confirma o descarta eventos detectados. Al confirmar, pasan a tu acreditación. */
  const reviewDetected = useCallback(async (ids: string[], accept: boolean) => {
    if (!userId || !supabase || !ids.length) return false
    const { error } = await supabase.rpc('review_detected', { event_ids: ids, accept })
    if (error) return false
    setDetected(list => list.filter(id => !ids.includes(id)))
    if (accept) {
      const next = { ...latest.current, myEvents: [...new Set([...latest.current.myEvents, ...ids])] }
      setState(next)
      write(userKey(userId), next)
    }
    return true
  }, [userId])

  const shown = userId ? { ...state, live: true, detected, reviewDetected, people, peopleLoading, peopleError, retryPeople, catalog, catalogLoading, catalogError, retryCatalog } : state
```

### 6.6 `scripts/test-people.mjs` (modificar)

El cliente simulado debe aceptar `.eq()` y `rpc()`. Además hay que probar las sombras.

```diff
-  const { loadPeople, peopleFromRows } = await server.ssrLoadModule('/src/features/badge/people.ts')
+  const { loadPeople, peopleFromRows, shadowsFromRows } = await server.ssrLoadModule('/src/features/badge/people.ts')
```

Añadir tras las comprobaciones de `others`:

```js
  // Sombras de Luma: una por invitado, sin la propia, en contactos pero no en "el resto".
  const shadows = shadowsFromRows([
    { event_id: 'real-a', person_id: 'p1', handle: 'luma_one', name: 'Luma One', avatar_url: 'https://img/1', is_me: false },
    { event_id: 'real-b', person_id: 'p1', handle: 'luma_one', name: 'Luma One', avatar_url: 'https://img/1', is_me: false },
    { event_id: 'real-b', person_id: 'p2', handle: 'luma_two', name: '', avatar_url: null, is_me: false },
    { event_id: 'real-a', person_id: 'p3', handle: 'luma_me', name: 'Me', avatar_url: null, is_me: true },
  ])
  assert.deepEqual(shadows.map(p => [p.id, p.events, p.shadow]), [['x:p1', ['real-a', 'real-b'], true], ['x:p2', ['real-b'], true]])
  assert.equal(shadows[1].name, '@luma_two')
  assert.ok(contacts(state.myEvents, [...people, ...shadows], catalog).some(p => p.id === 'x:p1'))
  assert.ok(!others([], [...people, ...shadows], catalog).some(p => p.shadow))
```

En el cliente simulado:

```diff
   function client(failedTable) {
-    return { from(table) {
+    return {
+    rpc(name) {
+      assert.equal(name, 'event_shadows')
+      let start, end
+      const query = {
+        range(a, b) { start = a; end = b; return query },
+        abortSignal() {
+          calls.push(['event_shadows', start, end])
+          return Promise.resolve(failedTable === 'event_shadows' ? { data: null, error: new Error('offline') } : { data: [], error: null })
+        },
+      }
+      return query
+    },
+    from(table) {
       let start, end
       const query = {
         select() { return query },
         neq(column, value) { assert.equal(value, 'me'); assert.equal(column, table === 'profiles' ? 'id' : 'profile_id'); return query },
+        eq(column, value) { assert.deepEqual([table, column, value], ['attendances', 'status', 'confirmed']); return query },
         order() { return query },
```

```diff
-  assert.equal(calls.length, 4)
-  for (const table of ['profiles', 'attendances']) {
+  assert.equal(calls.length, 5)
+  for (const table of ['profiles', 'attendances', 'event_shadows']) {
```

**Verificación:** `node scripts/test-people.mjs`, `cd web && npx tsc -b && npm run lint`.

---

## Paso 7 · Aviso de eventos detectados y sombras en el evento

### 7.1 `web/src/features/badge/bits.tsx` (modificar)

`Avatar` acepta una foto (las sombras traen la de Luma).

```diff
-export function Avatar({ name }: { name: string }) {
+export function Avatar({ name, photo }: { name: string; photo?: string | null }) {
+  if (photo) return <span className="av av-photo" aria-hidden="true"><img src={photo} alt="" loading="lazy" referrerPolicy="no-referrer" /></span>
   return (
```

### 7.2 `web/src/features/badge/DetectedEvents.tsx` (nuevo)

```tsx
import { useState } from 'react'
import type { TechEvent } from '../../data/sample'
import { fmtDate, plural, type BadgeState } from './model'

/* "Te hemos visto en N eventos": asistencias que Luma muestra y que aún no has confirmado.
   No se publican hasta que las confirmas. */
export function DetectedEvents({ state, notify }: { state: BadgeState; notify: (text: string) => void }) {
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const index = new Map((state.catalog?.events ?? []).map(e => [e.id, e]))
  const events = (state.detected ?? []).map(id => index.get(id)).filter((e): e is TechEvent => Boolean(e))
  if (hidden || !events.length || !state.reviewDetected) return null

  async function review(ids: string[], accept: boolean) {
    setBusy(true)
    const ok = await state.reviewDetected!(ids, accept)
    setBusy(false)
    if (!ok) return notify('No se ha podido guardar. Prueba de nuevo.')
    notify(accept ? `${plural(ids.length, 'evento añadido', 'eventos añadidos')} a tu acreditación` : 'Descartado')
  }

  return (
    <aside className="detected" aria-labelledby="detected-title" aria-busy={busy}>
      <strong id="detected-title">Te hemos visto en {plural(events.length, 'evento', 'eventos')}</strong>
      <p>Apareces en la lista pública de Luma. Confírmalos para añadirlos a tu acreditación; nadie más los ve hasta entonces.</p>
      <ul>
        {events.map(e => {
          const d = fmtDate(e)
          return (
            <li key={e.id}>
              <span className="detected-date">{d.day} {d.mon}</span>
              <span className="detected-name">{e.name}<small>{e.city}</small></span>
              <span className="detected-actions">
                <button type="button" className="pill is-on" disabled={busy} onClick={() => review([e.id], true)}>Confirmar</button>
                <button type="button" className="link" disabled={busy} onClick={() => review([e.id], false)}>Descartar</button>
              </span>
            </li>
          )
        })}
      </ul>
      <div className="detected-foot">
        {events.length > 1 && <button type="button" className="pill" disabled={busy} onClick={() => review(events.map(e => e.id), true)}>Confirmar todos</button>}
        <button type="button" className="link" onClick={() => setHidden(true)}>Ahora no</button>
      </div>
    </aside>
  )
}
```

### 7.3 `web/src/features/badge/BadgeApp.tsx` (modificar)

```diff
 import { ShareMenu } from './ShareMenu'
+import { DetectedEvents } from './DetectedEvents'
```

```diff
       <ShareMenu open={shareOpen} state={state} anchorRef={shareBtnRef} onClose={closeShare} />
+
+      {!sample && ready && <DetectedEvents state={state} notify={notify} />}
```

El manejador de clics fuera del panel (línea ~457) no debe cerrar el panel al pulsar el aviso:

```diff
-      if (target.closest('.mover, .panel, .toast, .credits, .share, .share-menu, .sign-out, .map-access, .site-header')) return
+      if (target.closest('.mover, .panel, .toast, .credits, .share, .share-menu, .sign-out, .map-access, .site-header, .detected')) return
```

### 7.4 `web/src/features/badge/panels/EventsPanel.tsx` · `EventView` (modificar)

Primero aparecen las personas registradas y después las sombras. Al final va el resto de asistentes que da Luma.

```diff
-  const attendees = peopleOf(state).filter(p => p.events.includes(e.id)).sort((a, b) => a.name.localeCompare(b.name, 'es'))
-  const total = attendees.length + (on ? 1 : 0)
+  const here = peopleOf(state).filter(p => p.events.includes(e.id))
+  const attendees = [
+    ...here.filter(p => !p.shadow).sort((a, b) => a.name.localeCompare(b.name, 'es')),
+    ...here.filter(p => p.shadow).sort((a, b) => a.name.localeCompare(b.name, 'es')),
+  ]
+  const total = attendees.length + (on ? 1 : 0)
+  // Luma cuenta también a quien no enseña su X: el resto, sin nombres.
+  const unnamed = Math.max(0, (e.guestCount ?? 0) - total)
```

```diff
         {attendees.map(p => (
           <li className="att-item" key={p.id}>
             <button className="att att-open" type="button" data-person={p.id} aria-label={`Ver perfil de ${p.name}`} onClick={() => onPerson(p.id)}>
-              <Avatar name={p.name} />
+              <Avatar name={p.name} photo={p.avatar} />
               <span className="p-info">
                 <strong>{p.name}</strong>
                 <span>{p.handle && <span className="p-handle">@{p.handle}</span>}{p.handle && p.role ? ' · ' : ''}{p.role}</span>
               </span>
+              {p.shadow && <span className="tag tag-luma">Visto en Luma</span>}
               <span className="p-chev" aria-hidden="true">→</span>
             </button>
           </li>
         ))}
+        {!state.peopleLoading && !state.peopleError && unnamed > 0 && (
+          <li className="empty att-more">+{unnamed} {unnamed === 1 ? 'asistente más' : 'asistentes más'} en Luma</li>
+        )}
-        {!state.peopleLoading && !state.peopleError && !attendees.length && !on && <li className="empty">Nadie de tu red {past ? 'fue' : 'va'} todavía.</li>}
+        {!state.peopleLoading && !state.peopleError && !attendees.length && !on && !unnamed && <li className="empty">Nadie de tu red {past ? 'fue' : 'va'} todavía.</li>}
```

### 7.5 `web/src/features/badge/panels/PeoplePanel.tsx` · `PersonView` (modificar)

```diff
+import { Link } from 'react-router-dom'
```

```diff
       <div className="pv-head" style={at(1)}>
-        <Avatar name={p.name} />
+        <Avatar name={p.name} photo={p.avatar} />
         <div>
           <strong>{p.name}</strong>
           {p.handle && <a className="p-handle pv-x" href={`https://x.com/${p.handle}`} target="_blank" rel="noopener noreferrer" aria-label={`Ver @${p.handle} en X`}>@{p.handle} ↗</a>}
-          <span>{p.role}</span>
+          <span>{p.shadow ? 'Visto en Luma' : p.role}</span>
         </div>
       </div>
       {p.bio && <p className="pv-bio" style={at(2)}>{p.bio}</p>}
+      {p.shadow && (
+        <p className="pv-bio pv-shadow" style={at(2)}>
+          Aparece en la lista pública de invitados de Luma con este X. Todavía no ha confirmado su asistencia en techxdir.{' '}
+          <Link className="link" to="/privacidad#ocultarme">¿Eres tú? Ocúltate</Link>
+        </p>
+      )}
```

`PeoplePanel` se renderiza dentro del router (la acreditación está en rutas), así que `Link` funciona. En `scripts/test-people.mjs` el `renderToStaticMarkup` de `PersonView` no tiene router. Por eso las pruebas de render solo usan personas que no son sombras: el `Link` solo se renderiza con `p.shadow`.

### 7.6 `web/src/styles/badge.css` (añadir al final, antes de `@media (max-width: 899px)`)

```css
/* ───────── Eventos detectados en Luma ───────── */

.detected {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 45;
  width: min(380px, calc(100vw - 32px));
  max-height: min(70dvh, 520px);
  overflow: auto;
  padding: 18px 18px 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--card);
  color: var(--ink);
  box-shadow: 0 18px 50px rgba(17, 17, 19, .16);
}
.detected > strong { display: block; font-size: 16px; }
.detected > p { margin: 6px 0 12px; color: var(--muted-text); font-size: 13px; line-height: 1.45; }
.detected ul { margin: 0; padding: 0; list-style: none; }
.detected li {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 4px 10px;
  padding: 10px 0;
  border-top: 1px solid var(--line);
}
.detected-date { font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--muted-text); }
.detected-name { font-size: 14px; font-weight: 600; }
.detected-name small { display: block; font-weight: 400; color: var(--muted-text); }
.detected-actions { grid-column: 2; display: flex; align-items: center; gap: 12px; }
.detected-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
.detected-foot .link:only-child { margin-left: auto; }

.tag-luma { margin-left: auto; white-space: nowrap; }
.att-more { font-style: normal; }
.pv-shadow { color: var(--muted-text); }

@media (max-width: 899px) {
  .detected { right: 16px; bottom: 16px; }
}
```

El `.toast` (z-index 50) queda por encima del aviso.

**Verificación:** `cd web && npx tsc -b && npm run lint && npm run build`, `node scripts/test-people.mjs`.

---

## Paso 8 · Privacidad y "Ocultarme"

### 8.1 `web/src/pages/AuthCallback.tsx` (modificar)

Hay que volver a la página que pidió el acceso, por ejemplo `/privacidad`. Solo se aceptan rutas internas.

```diff
 /* Vuelta de X. Si falta el usuario de X, se pide aquí antes de entrar en la acreditación. */
+
+// ?next=/privacidad → vuelve ahí. Solo rutas propias: nada de "//otro.sitio" ni URLs completas.
+function nextPath() {
+  const next = new URLSearchParams(location.search).get('next') ?? ''
+  return /^\/(?!\/)[\w\-/#]*$/.test(next) ? next : '/'
+}
```

Las dos llamadas `navigate('/', { replace: true })` pasan a ser `navigate(nextPath(), { replace: true })`.

### 8.2 `web/src/pages/Privacy.tsx` (nuevo)

```tsx
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { isDemo, supabase } from '../lib/supabase'
import '../styles/badge.css'
import './auth.css'
import './privacy.css'

/* Qué importamos de Luma y Meetup, y cómo dejar de aparecer. */

const xProvider = import.meta.env.VITE_X_AUTH_PROVIDER === 'x' ? 'x' : 'twitter'

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; text: string } | { kind: 'error'; text: string }

export function Privacy() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const busy = status.kind === 'busy'

  useEffect(() => {
    document.title = 'techxdir · Privacidad'
    if (location.hash === '#ocultarme') document.getElementById('ocultarme')?.scrollIntoView()
  }, [])

  async function signIn() {
    if (!supabase) return
    setStatus({ kind: 'busy' })
    const { error } = await supabase.auth.signInWithOAuth({
      provider: xProvider,
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent('/privacidad#ocultarme')}` },
    })
    if (error) setStatus({ kind: 'error', text: 'No hemos podido abrir X. Prueba de nuevo.' })
  }

  async function hide(deleteAccount: boolean) {
    if (!supabase) return
    setStatus({ kind: 'busy' })
    const { error } = await supabase.rpc('hide_me', { delete_account: deleteAccount })
    if (error) {
      setStatus({ kind: 'error', text: error.code === '42501'
        ? 'Necesitamos que entres con X para saber que la cuenta es tuya.'
        : 'No hemos podido completarlo. Prueba de nuevo.' })
      return
    }
    if (deleteAccount) {
      await supabase.auth.signOut()
      navigate('/', { replace: true })
      return
    }
    setStatus({ kind: 'done', text: 'Hecho. Hemos borrado lo que importamos de Luma sobre ti y no volverás a aparecer.' })
  }

  return (
    <div className="au pv">
      <header className="au-top">
        <Link to="/" className="wordmark au-mark">techx<b>dir</b></Link>
      </header>
      <main className="pv-main">
        <h1>Privacidad</h1>
        <p className="pv-lede">techxdir junta la gente que coincide en eventos tech de España. Esto es lo que leemos y por qué.</p>

        <h2>Eventos</h2>
        <p>Importamos los eventos públicos de los calendarios de Luma y de los grupos de Meetup que añaden las comunidades. Solo guardamos el nombre, la fecha, la ciudad y el enlace.</p>

        <h2>Asistentes</h2>
        <p>De Luma leemos solo la muestra pública de invitados que el propio evento enseña (anfitriones y asistentes destacados), y solo de quien ha puesto su usuario de X en su perfil de Luma. Guardamos ese usuario, el nombre y la foto.</p>
        <ul>
          <li>Solo lo ven las personas que han entrado en techxdir, nunca las acreditaciones públicas.</li>
          <li>Si entras con ese mismo X, te proponemos los eventos para que los confirmes. No aparecen en tu acreditación hasta que lo haces.</li>
          <li>Borramos a quien no ha vuelto a aparecer en ningún evento en 12 meses.</li>
        </ul>

        <section id="ocultarme" className="pv-hide" aria-labelledby="pv-hide-title">
          <h2 id="pv-hide-title">Ocultarme</h2>
          <p>Entra con tu X para demostrar que es tuyo. Borramos lo importado y no volvemos a guardar ese usuario.</p>
          {isDemo && <p role="note">Modo demo: no se puede entrar en este entorno.</p>}
          {!session && (
            <button type="button" className="primary" onClick={signIn} disabled={isDemo || busy}>
              {busy ? 'Abriendo X…' : 'Entrar con X para ocultarme'}
            </button>
          )}
          {session && status.kind !== 'done' && (
            <div className="pv-actions">
              <button type="button" className="primary" onClick={() => hide(false)} disabled={busy}>Ocultarme</button>
              <button type="button" className="link" onClick={() => hide(true)} disabled={busy}>Ocultarme y borrar mi cuenta</button>
            </div>
          )}
          {status.kind === 'done' && <p role="status">{status.text}</p>}
          {status.kind === 'error' && <p className="au-error" role="alert">{status.text}</p>}
        </section>
      </main>
    </div>
  )
}
```

### 8.3 `web/src/pages/privacy.css` (nuevo)

```css
/* /privacidad: una página de texto con el mismo encabezado que /entrar */

.pv-main {
  width: min(680px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 8px 0 64px;
  color: var(--ink);
  line-height: 1.55;
}
.pv-main h1 { margin: 0 0 8px; font-size: clamp(28px, 5vw, 40px); letter-spacing: -.02em; }
.pv-main h2 { margin: 32px 0 8px; font-size: 18px; }
.pv-main p, .pv-main li { color: var(--muted-text); font-size: 15px; }
.pv-main ul { padding-left: 20px; }
.pv-lede { font-size: 17px; }
.pv-hide {
  margin-top: 40px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--card);
  scroll-margin-top: 24px;
}
.pv-hide h2 { margin-top: 0; }
.pv-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
```

### 8.4 `web/src/App.tsx` (modificar)

```diff
 import { Organizations } from './pages/Organizations'
+import { Privacy } from './pages/Privacy'
```

```diff
           <Route path="/auth/callback" element={<AuthCallback />} />
+          <Route path="/privacidad" element={<Privacy />} />
```

### 8.5 Enlaces en los pies

`web/src/pages/Landing.tsx`, en el `footer.credits.lp-credits`, al final:

```diff
         {' '}y <a href="https://x.com/elashera" target="_blank" rel="noopener noreferrer">@elashera</a>
+        <span aria-hidden="true"> · </span><Link to="/privacidad">Privacidad</Link>
       </footer>
```

Hay que importar `Link` si `Landing.tsx` no lo hace ya.

`web/src/features/badge/BadgeApp.tsx`, en el `footer.credits`:

```diff
         {' '}and <a href="https://x.com/elashera" target="_blank" rel="noopener noreferrer">@elashera</a>
+        <span aria-hidden="true"> · </span><Link to="/privacidad">Privacidad</Link>
       </footer>}
```

**Verificación:**

- `/privacidad` sin sesión muestra "Entrar con X para ocultarme".
- Con sesión, "Ocultarme" llama a `hide_me`. Con un usuario sin identidad de X devuelve el mensaje de 42501.
- `/auth/callback?next=//evil.com` navega a `/`.

### 8.6 `supabase/config.toml` (modificar)

El retorno con `?next=` necesita permitir la ruta con parámetros:

```diff
-additional_redirect_urls = ["http://127.0.0.1:55330/auth/callback"]
+additional_redirect_urls = ["http://127.0.0.1:55330/auth/callback**"]
```

En producción hay que añadir el mismo patrón en Authentication → URL Configuration. Queda anotado en el README (paso 10).

---

## Paso 9 · Administración: fuentes, sincronización y revisión

### 9.1 `web/src/features/sources/api.ts` (nuevo)

```ts
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

export type SourceRow = {
  id: string; org_id: string; kind: 'luma_calendar' | 'meetup_ical'; url: string; name: string
  country_filter: string | null; enabled: boolean; last_synced_at: string | null; last_error: string | null
}
export const SOURCE_COLUMNS = 'id, org_id, kind, url, name, country_filter, enabled, last_synced_at, last_error'

/** Calls an ingestion function and turns its { error } body into the thrown message. */
export async function callFunction<T>(name: 'add-url' | 'sync-sources' | 'sync-guests', body: object): Promise<T> {
  if (!supabase) throw new Error('Supabase no está configurado')
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let message = 'No se pudo completar.'
    if (error instanceof FunctionsHttpError) {
      try { message = (await error.context.json()).error ?? message } catch { /* sin cuerpo */ }
    }
    throw new Error(message)
  }
  return data as T
}

export type AddUrlInput = { url: string; org_id?: string; new_org?: string; country_filter?: 'ES' | null }
export type AddUrlResult =
  | { kind: 'source'; source: SourceRow; stats: { created: number; updated: number; errors: string[] } }
  | { kind: 'event'; event: { id: string; status: string } }

export const addUrl = (input: AddUrlInput) => callFunction<AddUrlResult>('add-url', input)
export const syncSourceNow = (sourceId: string) =>
  callFunction<{ created: number; updated: number; canceled: number; errors: string[] }>('sync-sources', { job: 'sources', source_id: sourceId })

/** "hace 3 h" para las fechas de sincronización. */
export function ago(iso: string | null): string {
  if (!iso) return 'nunca'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'ahora mismo'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `hace ${hours} h`
  return `hace ${Math.round(hours / 24)} días`
}
```

### 9.2 `web/src/features/sources/SourceManager.tsx` (nuevo)

La usan `/admin/fuentes` (todas las organizaciones) y `/organizaciones` (una sola).

```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { addUrl, ago, SOURCE_COLUMNS, syncSourceNow, type SourceRow } from './api'
import './sources.css'

type OrgOption = { id: string; name: string }

/* Fuentes de eventos: añadir por URL, activar o pausar, sincronizar y quitar. */
export function SourceManager({ orgs, orgId, admin, busy, run }: {
  orgs: OrgOption[]
  /** Solo las fuentes de esta organización (página de organizaciones) */
  orgId?: string
  admin: boolean
  busy: boolean
  run: (action: () => Promise<void>, success: string) => Promise<unknown>
}) {
  const [sources, setSources] = useState<SourceRow[] | null>(null)
  const [url, setUrl] = useState('')
  const [target, setTarget] = useState(orgId ?? orgs[0]?.id ?? '')
  const [onlySpain, setOnlySpain] = useState(false)

  const reload = useCallback(async () => {
    if (!supabase) return
    let query = supabase.from('event_sources').select(SOURCE_COLUMNS).order('created_at', { ascending: false })
    if (orgId) query = query.eq('org_id', orgId)
    const { data, error } = await query
    if (error) throw error
    setSources(data as SourceRow[])
  }, [orgId])

  useEffect(() => { void reload().catch(() => setSources([])) }, [reload])

  const orgName = new Map(orgs.map(org => [org.id, org.name]))
  const change = (action: () => Promise<void>, success: string) => run(async () => { await action(); await reload() }, success)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = url.trim()
    if (!value || !target) return
    void change(async () => {
      const result = await addUrl({ url: value, org_id: target, country_filter: onlySpain ? 'ES' : null })
      setUrl('')
      if (result.kind === 'source' && result.stats.errors.length) throw new Error(`Fuente añadida, pero la primera lectura falló: ${result.stats.errors[0]}`)
    }, 'Añadido. Los eventos nuevos ya están importados.')
  }

  return (
    <div className="src">
      <form className="src-add" onSubmit={submit}>
        <label className="src-url">
          <span>Añadir por URL</span>
          <input type="url" required value={url} onChange={event => setUrl(event.target.value)}
            placeholder="https://luma.com/tu-calendario · https://www.meetup.com/tu-grupo" />
        </label>
        {!orgId && (
          <label className="src-org">
            <span>Organización</span>
            <select value={target} onChange={event => setTarget(event.target.value)}>
              {orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
          </label>
        )}
        <label className="src-check">
          <input type="checkbox" checked={onlySpain} onChange={event => setOnlySpain(event.target.checked)} />
          <span>Solo eventos en España</span>
        </label>
        <button className="src-pill" disabled={busy || !url.trim()}>Añadir</button>
        <small className="src-help">Un calendario de Luma o un grupo de Meetup se sincroniza cada día. Un evento suelto de Luma entra como borrador{admin ? '' : ' para que lo revises'}.</small>
      </form>

      {!sources ? <p className="src-empty" aria-busy="true">Cargando fuentes…</p> : !sources.length ? (
        <p className="src-empty">Aún no hay fuentes. Pega el enlace del calendario de Luma o del grupo de Meetup.</p>
      ) : (
        <ul className="src-list">
          {sources.map(src => (
            <li key={src.id} className={src.enabled ? undefined : 'is-off'}>
              <div className="src-main">
                <span className="src-kind">{src.kind === 'luma_calendar' ? 'Luma' : 'Meetup'}</span>
                <a href={src.url} target="_blank" rel="noopener noreferrer"><strong>{src.name || src.url}</strong></a>
                <small>
                  {!orgId && <>{orgName.get(src.org_id) ?? src.org_id} · </>}
                  {src.country_filter ? `solo ${src.country_filter} · ` : ''}
                  sincronizada {ago(src.last_synced_at)}
                </small>
                {src.last_error && <small className="src-error" role="note">Último error: {src.last_error}</small>}
              </div>
              <div className="src-actions">
                <button type="button" className="src-link" disabled={busy || !src.enabled}
                  onClick={() => void change(async () => {
                    const stats = await syncSourceNow(src.id)
                    if (stats.errors.length) throw new Error(stats.errors[0])
                  }, 'Sincronizada.')}>Sincronizar ahora</button>
                <button type="button" className="src-link" disabled={busy}
                  onClick={() => void change(async () => {
                    const { error } = await supabase!.from('event_sources').update({ enabled: !src.enabled }).eq('id', src.id)
                    if (error) throw error
                  }, src.enabled ? 'Fuente pausada.' : 'Fuente activada.')}>{src.enabled ? 'Pausar' : 'Activar'}</button>
                <button type="button" className="src-link src-danger" disabled={busy}
                  onClick={() => void change(async () => {
                    const { error } = await supabase!.from('event_sources').delete().eq('id', src.id)
                    if (error) throw error
                  }, 'Fuente quitada. Sus eventos se quedan.')}>Quitar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

### 9.3 `web/src/features/sources/sources.css` (nuevo)

Usa los mismos tokens que `admin.css`, pero sin depender de `.adm`, porque también se muestra en `/organizaciones`.

```css
.src { display: grid; gap: 20px; }
.src-add { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px 16px; align-items: end; }
.src-add > label > span { display: block; margin-bottom: 8px; font: 500 10.5px/1 var(--mono); letter-spacing: .15em; text-transform: uppercase; color: var(--muted-text); }
.src-add input[type='url'], .src-add select { width: 100%; padding: 10px 0; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--ink); font: inherit; }
.src-add input[type='url']:focus-visible, .src-add select:focus-visible { outline: none; border-bottom-color: var(--ink); }
.src-url { grid-column: 1 / -1; }
.src-check { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.src-check > span { margin: 0 !important; font: inherit !important; letter-spacing: 0 !important; text-transform: none !important; color: var(--ink) !important; }
.src-help { grid-column: 1 / -1; color: var(--muted-text); font-size: 12px; }
.src-pill { padding: 11px 20px; border-radius: 99px; background: var(--ink); color: var(--card); font-weight: 500; }
.src-pill:disabled { opacity: .35; cursor: not-allowed; }
.src-empty { color: var(--muted-text); font-size: 14px; }
.src-list { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--line); }
.src-list > li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px 24px; padding: 16px 0; border-bottom: 1px solid var(--line); }
.src-list > li.is-off { opacity: .55; }
.src-main { display: grid; gap: 4px; min-width: 0; }
.src-main a { color: var(--ink); text-decoration: none; overflow-wrap: anywhere; }
.src-main small { color: var(--muted-text); font-size: 12.5px; }
.src-kind { justify-self: start; padding: 4px 8px; border-radius: 99px; box-shadow: inset 0 0 0 1px var(--line); font: 500 10px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; }
.src-error { color: #b54020 !important; }
.src-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
.src-link { font: 500 13px var(--mono); color: var(--ink); text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 4px; }
.src-link:hover { text-decoration-color: var(--ink); }
.src-link:disabled { opacity: .4; cursor: not-allowed; }
.src-danger { color: #b54020; }

@media (max-width: 640px) {
  .src-add { grid-template-columns: 1fr; }
}
```

### 9.4 `web/src/pages/admin/context.ts` (modificar)

```diff
 export type AdminEvent = {
   id: string; org_id: string; name: string; short: string; city: string
   starts_on: string; ends_on: string | null; url: string | null; kind: string; color: string
+  status?: 'draft' | 'published' | 'canceled' | 'merged'
+  external_kind?: 'luma' | 'meetup' | null
+  duplicate_of?: string | null
+  guest_count?: number | null
 }
-export type Counts = { people: number; orgs: number; events: number; bans: number; admins: number }
+export type Counts = { people: number; orgs: number; events: number; bans: number; admins: number; review: number; suggestions: number }
+
+/** Lo que se puede editar a mano de un evento (las columnas con grant update). */
+export const editableEvent = ({ name, short, city, starts_on, ends_on, url, kind, color }: AdminEvent) =>
+  ({ name, short, city, starts_on, ends_on, url, kind, color })
```

### 9.5 `web/src/pages/Admin.tsx` (modificar)

Los contadores añaden los borradores pendientes de revisar y las sugerencias:

```diff
 async function loadCounts(): Promise<Counts> {
   if (!supabase) throw new Error('Supabase is not configured')
   const count = (table: string) => supabase!.from(table).select('*', { count: 'exact', head: true })
-  const [people, orgs, events, bans, admins] = await Promise.all([
-    count('profiles'), count('orgs'), count('events'), count('bans'), count('app_admins'),
+  const [people, orgs, events, bans, admins, review, suggestions] = await Promise.all([
+    count('profiles'), count('orgs'), count('events'), count('bans'), count('app_admins'),
+    supabase.from('events').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
+    supabase.from('import_suggestions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
   ])
-  const failed = [people, orgs, events, bans, admins].find(result => result.error)
+  const failed = [people, orgs, events, bans, admins, review, suggestions].find(result => result.error)
   if (failed?.error) throw failed.error
-  return { people: people.count ?? 0, orgs: orgs.count ?? 0, events: events.count ?? 0, bans: bans.count ?? 0, admins: admins.count ?? 0 }
+  return {
+    people: people.count ?? 0, orgs: orgs.count ?? 0, events: events.count ?? 0, bans: bans.count ?? 0, admins: admins.count ?? 0,
+    review: review.count ?? 0, suggestions: suggestions.count ?? 0,
+  }
 }
```

```diff
-  { to: '/admin/eventos', label: 'Eventos', count: c => c.events },
+  { to: '/admin/eventos', label: 'Eventos', count: c => c.events, note: c => c.review ? `${c.review} por revisar` : null },
+  { to: '/admin/fuentes', label: 'Fuentes', note: c => c.suggestions ? `${c.suggestions} sugerencias` : null },
+  { to: '/admin/sincronizacion', label: 'Sincronización' },
```

### 9.6 `web/src/pages/admin/SourcesSection.tsx` (nuevo)

```tsx
import { useCallback, useEffect, useState } from 'react'
import { errorText } from '../../lib/dbError'
import { supabase } from '../../lib/supabase'
import { addUrl } from '../../features/sources/api'
import { SourceManager } from '../../features/sources/SourceManager'
import { formatDate, useAdmin, type Org } from './context'
import { Empty, SectionHead } from './shared'

type Suggestion = {
  id: string; kind: 'luma_calendar' | 'luma_event'; external_id: string; url: string; name: string
  city: string | null; starts_on: string | null; found_via: string
}

export function SourcesSection() {
  const { busy, run } = useAdmin()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState('')

  const reload = useCallback(async () => {
    const client = supabase
    if (!client) return
    const [orgResult, suggestionResult] = await Promise.all([
      client.from('orgs').select('id, name, logo').order('name'),
      client.from('import_suggestions').select('id, kind, external_id, url, name, city, starts_on, found_via')
        .eq('status', 'pending').order('created_at', { ascending: false }).limit(100),
    ])
    const failed = orgResult.error || suggestionResult.error
    if (failed) throw failed
    setOrgs(orgResult.data ?? [])
    setSuggestions(suggestionResult.data ?? [])
  }, [])

  useEffect(() => { void Promise.resolve().then(reload).catch(err => setLoadError(errorText(err))) }, [reload])

  const change = (action: () => Promise<void>, success: string) => run(async () => { await action(); await reload() }, success)
  // '' = crear una organización con el nombre del calendario
  const targetOf = (s: Suggestion) => targets[s.id] ?? (s.kind === 'luma_calendar' ? '' : orgs[0]?.id ?? '')

  return (
    <>
      <SectionHead title="Fuentes" />
      {loadError && <p className="adm-error" role="alert">{loadError}</p>}
      {orgs.length > 0 && <SourceManager orgs={orgs} admin busy={busy} run={change} />}

      <h2 className="adm-subhead">Sugerencias del descubrimiento</h2>
      <p className="adm-note">Calendarios y eventos de Luma en Madrid y Barcelona que aún no seguimos. Nada se importa hasta que lo aceptas.</p>
      {!suggestions ? null : !suggestions.length ? <Empty>No hay sugerencias pendientes.</Empty> : (
        <ul className="adm-ledger">
          {suggestions.map(s => (
            <li key={s.id}>
              <div className="adm-row adm-row-static">
                <span className="adm-date">{s.kind === 'luma_calendar' ? 'Calendario' : s.starts_on ? formatDate(s.starts_on) : 'Evento'}</span>
                <span className="adm-row-main">
                  <strong><a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a></strong>
                  <small>{s.city ?? 'Sin ciudad'} · {s.found_via.replace('discover:', 'visto en ')}</small>
                </span>
                <span className="adm-suggest-actions">
                  <select aria-label="Organización" value={targetOf(s)} onChange={event => setTargets(t => ({ ...t, [s.id]: event.target.value }))}>
                    {s.kind === 'luma_calendar' && <option value="">Nueva: {s.name}</option>}
                    {orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
                  </select>
                  <button type="button" className="adm-pill adm-pill-quiet" disabled={busy}
                    onClick={() => void change(async () => {
                      const org = targetOf(s)
                      await addUrl(org ? { url: s.url, org_id: org } : { url: s.url, new_org: s.name })
                    }, s.kind === 'luma_calendar' ? 'Calendario añadido como fuente.' : 'Evento importado como borrador.')}>Aceptar</button>
                  <button type="button" className="adm-link" disabled={busy}
                    onClick={() => void change(async () => {
                      const { error } = await supabase!.from('import_suggestions').update({ status: 'dismissed' }).eq('id', s.id)
                      if (error) throw error
                    }, 'Sugerencia descartada.')}>Descartar</button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
```

### 9.7 `web/src/pages/admin/SyncSection.tsx` (nuevo)

```tsx
import { useCallback, useEffect, useState } from 'react'
import { errorText } from '../../lib/dbError'
import { supabase } from '../../lib/supabase'
import { callFunction } from '../../features/sources/api'
import { formatDate, useAdmin } from './context'
import { Empty, SectionHead, SkeletonRows } from './shared'

type Run = { id: number; job: string; started_at: string; finished_at: string | null; ok: boolean | null; stats: Record<string, unknown>; error: string | null }
type Coverage = { synced_events: number; guest_total: number; with_handle: number; coverage: number | null }
type Settings = Record<'guest_ingest_enabled' | 'luma_full_list_enabled', boolean>

const JOBS: Record<string, string> = { sources: 'Fuentes', discover: 'Descubrimiento', guests: 'Asistentes', retention: 'Retención' }

function summary(stats: Record<string, unknown>) {
  return Object.entries(stats)
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => `${key} ${value}`).join(' · ')
}

export function SyncSection() {
  const { busy, run } = useAdmin()
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loadError, setLoadError] = useState('')

  const reload = useCallback(async () => {
    const client = supabase
    if (!client) return
    const [runResult, coverageResult, settingResult] = await Promise.all([
      client.from('sync_runs').select('id, job, started_at, finished_at, ok, stats, error').order('started_at', { ascending: false }).limit(30),
      client.rpc('ingest_coverage').single(),
      client.from('app_settings').select('key, value'),
    ])
    const failed = runResult.error || coverageResult.error || settingResult.error
    if (failed) throw failed
    setRuns(runResult.data as Run[])
    setCoverage(coverageResult.data as Coverage)
    setSettings(Object.fromEntries((settingResult.data ?? []).map(row => [row.key, row.value === true])) as Settings)
  }, [])

  useEffect(() => { void Promise.resolve().then(reload).catch(err => setLoadError(errorText(err))) }, [reload])

  const change = (action: () => Promise<void>, success: string) => run(async () => { await action(); await reload() }, success)
  const launch = (fn: 'sync-sources' | 'sync-guests', body: object, label: string) => void change(async () => {
    const result = await callFunction<{ errors?: string[] }>(fn, body)
    if (result.errors?.length) throw new Error(`${label}: ${result.errors[0]}`)
  }, `${label}: hecho.`)
  const toggle = (key: keyof Settings) => void change(async () => {
    const { error } = await supabase!.from('app_settings').update({ value: !settings?.[key] }).eq('key', key)
    if (error) throw error
  }, 'Ajuste guardado.')

  return (
    <>
      <SectionHead title="Sincronización" />
      {loadError && <p className="adm-error" role="alert">{loadError}</p>}

      <div className="adm-sync-grid">
        <section>
          <h2 className="adm-subhead">Lanzar ahora</h2>
          <div className="adm-actions">
            <button type="button" className="adm-pill" disabled={busy} onClick={() => launch('sync-sources', { job: 'sources', force: true }, 'Fuentes')}>Sincronizar fuentes</button>
            <button type="button" className="adm-pill adm-pill-quiet" disabled={busy} onClick={() => launch('sync-guests', {}, 'Asistentes')}>Leer asistentes</button>
            <button type="button" className="adm-pill adm-pill-quiet" disabled={busy} onClick={() => launch('sync-sources', { job: 'discover' }, 'Descubrimiento')}>Descubrir</button>
          </div>
          <p className="adm-note">Se ejecutan solas: fuentes cada día a las 06:00, asistentes cada hora y descubrimiento los lunes.</p>
        </section>

        <section>
          <h2 className="adm-subhead">Asistentes de Luma</h2>
          {coverage && (
            <p className="adm-coverage">
              <strong>{coverage.coverage === null ? '–' : `${Math.round(coverage.coverage * 100)} %`}</strong>
              <span>{coverage.with_handle} con X de {coverage.guest_total} asistentes en {coverage.synced_events} eventos</span>
            </p>
          )}
          {settings && (
            <div className="adm-switches">
              <label><input type="checkbox" checked={settings.guest_ingest_enabled} disabled={busy} onChange={() => toggle('guest_ingest_enabled')} /> Leer la muestra pública de invitados (Fase A)</label>
              <label><input type="checkbox" checked={settings.luma_full_list_enabled} disabled={busy} onChange={() => toggle('luma_full_list_enabled')} /> Lista completa con cuenta propia (Fase B, sin implementar)</label>
            </div>
          )}
        </section>
      </div>

      <h2 className="adm-subhead">Últimas ejecuciones</h2>
      {!runs ? <SkeletonRows rows={3} /> : !runs.length ? <Empty>Todavía no se ha ejecutado nada.</Empty> : (
        <ul className="adm-ledger">
          {runs.map(r => (
            <li key={r.id}>
              <div className="adm-row adm-row-static">
                <time className="adm-date" dateTime={r.started_at}>{formatDate(r.started_at)} {r.started_at.slice(11, 16)}</time>
                <span className="adm-row-main">
                  <strong>{JOBS[r.job] ?? r.job}</strong>
                  <small>{r.error ?? (summary(r.stats) || 'sin cambios')}</small>
                </span>
                <span className={`adm-tag${r.ok === false ? ' adm-tag-ban' : ''}`}>{r.ok === null ? 'En curso' : r.ok ? 'OK' : 'Error'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
```

### 9.8 `web/src/pages/admin/EventsSection.tsx` (modificar)

Cambios:

1. Más columnas y un filtro de estado ("Por revisar" = borradores).
2. Etiquetas de origen y estado en cada fila.
3. En el editor de un borrador: "Publicar". Si es un posible duplicado, el otro evento al lado con "Fusionar" y "No es duplicado".
4. La edición manda solo las columnas editables (`editableEvent`). Si mandara `status` u otras columnas, PostgREST respondería 42501.

```diff
-import { formatDate, slugify, slugPattern, useAdmin, type AdminEvent, type Org } from './context'
+import { editableEvent, formatDate, slugify, slugPattern, useAdmin, type AdminEvent, type Org } from './context'

-type When = 'upcoming' | 'past' | 'all'
-const COLUMNS = 'id, org_id, name, short, city, starts_on, ends_on, url, kind, color'
+type When = 'upcoming' | 'past' | 'all' | 'review'
+const COLUMNS = 'id, org_id, name, short, city, starts_on, ends_on, url, kind, color, status, external_kind, duplicate_of, guest_count'
-const whenLabels: Record<When, string> = { upcoming: 'Próximos', past: 'Pasados', all: 'Todos' }
+const whenLabels: Record<When, string> = { upcoming: 'Próximos', past: 'Pasados', all: 'Todos', review: 'Por revisar' }
+const statusLabels = { draft: 'Borrador', canceled: 'Cancelado', merged: 'Fusionado' } as const
```

En `reload`, la asistencia cuenta solo las confirmadas:

```diff
-      client.from('attendances').select('event_id'),
+      client.from('attendances').select('event_id').eq('status', 'confirmed'),
```

Filtro (`visible`):

```diff
     const rows = (events ?? []).filter(event =>
       (!orgFilter || event.org_id === orgFilter)
-      && (when === 'all' || (when === 'upcoming' ? (event.ends_on ?? event.starts_on) >= today : (event.ends_on ?? event.starts_on) < today))
+      && (when === 'review' ? event.status === 'draft' : event.status !== 'merged')
+      && (when === 'all' || when === 'review' || (when === 'upcoming' ? (event.ends_on ?? event.starts_on) >= today : (event.ends_on ?? event.starts_on) < today))
       && (!q || [event.name, event.short, event.city, event.id].some(value => value.toLowerCase().includes(q))))
```

Y `const byId = useMemo(() => new Map((events ?? []).map(e => [e.id, e])), [events])` junto a `orgName`.

Fila:

```diff
                   <span className="adm-row-main"><strong>{event.name}</strong><small>{orgName.get(event.org_id) ?? event.org_id} · {event.city}</small></span>
+                  <span className="adm-tags">
+                    {event.external_kind && <span className="adm-tag adm-tag-ban">{event.external_kind === 'luma' ? 'Luma' : 'Meetup'}</span>}
+                    {event.status && event.status !== 'published' && <span className="adm-tag">{statusLabels[event.status]}{event.duplicate_of ? ' · duplicado' : ''}</span>}
+                  </span>
                   <span className="adm-row-meta">{people} {people === 1 ? 'asistente' : 'asistentes'}</span>
```

Editor (antes del `EventForm` existente):

```tsx
                    {event.status === 'draft' && (
                      <div className="adm-review">
                        {event.duplicate_of && byId.get(event.duplicate_of) && (() => {
                          const twin = byId.get(event.duplicate_of!)!
                          return (
                            <div className="adm-twins">
                              <p>Puede ser el mismo evento que este:</p>
                              <dl>
                                <div><dt>Este</dt><dd>{event.name}<small>{formatDate(event.starts_on)} · {event.city} · {event.external_kind ?? 'manual'}</small></dd></div>
                                <div><dt>Ya existe</dt><dd>{twin.name}<small>{formatDate(twin.starts_on)} · {twin.city} · {twin.external_kind ?? 'manual'}</small></dd></div>
                              </dl>
                              <div className="adm-actions">
                                <button type="button" className="adm-pill" disabled={busy} onClick={() => void change(async () => {
                                  const { error } = await supabase!.rpc('merge_events', { duplicate: event.id, main: twin.id })
                                  if (error) throw error
                                  setOpenId(null)
                                }, 'Eventos fusionados.')}>Fusionar en «{twin.short}»</button>
                                <button type="button" className="adm-link" disabled={busy} onClick={() => void change(async () => {
                                  const { error } = await supabase!.from('events').update({ duplicate_of: null }).eq('id', event.id)
                                  if (error) throw error
                                }, 'Marcado como evento distinto.')}>No es duplicado</button>
                              </div>
                            </div>
                          )
                        })()}
                        <div className="adm-actions">
                          <button type="button" className="adm-pill" disabled={busy || !event.city} title={event.city ? undefined : 'Añade la ciudad antes de publicar'}
                            onClick={() => void change(async () => {
                              const { error } = await supabase!.from('events').update({ status: 'published', duplicate_of: null }).eq('id', event.id)
                              if (error) throw error
                            }, 'Evento publicado.')}>Publicar</button>
                          {!event.city && <small>Falta la ciudad: complétala abajo y guarda.</small>}
                        </div>
                      </div>
                    )}
```

Guardar:

```diff
-                      const { id: _id, org_id: _org, ...patch } = row
-                      const { data, error } = await supabase!.from('events').update(patch).eq('id', event.id).select('id').single()
+                      const { data, error } = await supabase!.from('events').update(editableEvent(row)).eq('id', event.id).select('id').single()
```

En `EventForm`, el estado inicial al crear incluye `status: 'published'`. Al crear, el insert manda solo las columnas con grant:

```diff
-          const { error } = await supabase!.from('events').insert(row)
+          const { error } = await supabase!.from('events').insert({ id: row.id, org_id: row.org_id, ...editableEvent(row) })
```

### 9.9 `web/src/pages/admin/admin.css` (añadir)

```css
.adm-subhead { margin: 40px 0 12px; font: 500 10.5px/1 var(--mono); letter-spacing: .15em; text-transform: uppercase; color: var(--muted-text); }
.adm-note { margin: 0 0 16px; color: var(--muted-text); font-size: 13px; }
.adm-row-static { cursor: default; }
.adm-row-main a { color: inherit; text-decoration: none; }
.adm-suggest-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.adm-suggest-actions select { max-width: 220px; padding: 6px 0; border: 0; border-bottom: 1px solid var(--line); background: transparent; font: inherit; font-size: 13px; }
.adm-review { display: grid; gap: 16px; margin-bottom: 24px; padding: 16px; border: 1px solid var(--line); border-radius: 12px; }
.adm-review small { color: var(--muted-text); font-size: 12px; }
.adm-twins dl { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 8px 0 12px; }
.adm-twins dt { font: 500 10.5px/1 var(--mono); letter-spacing: .15em; text-transform: uppercase; color: var(--muted-text); }
.adm-twins dd { margin: 6px 0 0; font-weight: 600; }
.adm-twins dd small { display: block; font-weight: 400; }
.adm-sync-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0 40px; }
.adm-coverage { display: flex; align-items: baseline; gap: 12px; margin: 0 0 16px; }
.adm-coverage strong { font-size: 32px; letter-spacing: -.02em; }
.adm-coverage span { color: var(--muted-text); font-size: 13px; }
.adm-switches { display: grid; gap: 10px; font-size: 14px; }
.adm-switches label { display: flex; gap: 10px; align-items: center; }
@media (max-width: 640px) { .adm-twins dl { grid-template-columns: 1fr; } }
```

### 9.10 `web/src/App.tsx` (modificar)

```diff
 import { OrgsSection } from './pages/admin/OrgsSection'
+import { SourcesSection } from './pages/admin/SourcesSection'
+import { SyncSection } from './pages/admin/SyncSection'
```

```diff
             <Route path="eventos" element={<EventsSection />} />
+            <Route path="fuentes" element={<SourcesSection />} />
+            <Route path="sincronizacion" element={<SyncSection />} />
```

### 9.11 `web/src/pages/Organizations.tsx` (modificar)

Cada organización que gestionas muestra sus fuentes. `change` ya tiene la firma `(action, success) => Promise<void>`.

```diff
+import { SourceManager } from '../features/sources/SourceManager'
```

Dentro de `{canEdit && <div className="org-controls">…`, después del formulario "Añadir gestor":

```tsx
                  <div className="org-sources">
                    <h4>Fuentes de eventos</h4>
                    <SourceManager orgs={[org]} orgId={org.id} admin={false} busy={busy} run={change} />
                  </div>
```

Y en `organizations.css`: `.org-sources { grid-column: 1 / -1; padding-top: 16px; border-top: 1px solid var(--line); }`.

Los gestores ven en `/admin` → "Solo para administradores". Los borradores de su organización los publican desde `/organizaciones`: no hay editor de eventos ahí y queda fuera de este plan. El admin publica en `/admin/eventos`. Un gestor que añade una fuente obtiene eventos publicados directamente, porque una fuente curada publica (spec §5).

**Verificación:** `cd web && npx tsc -b && npm run lint && npm run build`.

---

## Paso 10 · README y datos locales

### 10.1 `scripts/seed-local-ingest.sql` (nuevo)

Datos para probar en local sin depender de la red: una fuente, dos eventos importados (uno es un duplicado de Meetup) e invitados de ejemplo inventados. Ninguno es una persona real.

```sql
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
```

Para ver el aviso "Te hemos visto…" con tu usuario de prueba, añade un invitado con tu handle de X verificado en local:

```sql
select public.ingest_guests('demo-noche-ia-2', '[{"luma_user_id":"usr-demo-me","handle":"<tu_handle>","name":"Yo"}]'::jsonb, 64);
```

### 10.2 `README.md` (modificar)

- **Scripts:**
  - `deno task test` ahora cubre `profile/` y `_shared/`.
  - Añadir `psql "$DB_URL" -f scripts/seed-local-ingest.sql`.
- **Rutas:** `/privacidad`, `/admin/fuentes` y `/admin/sincronizacion`.
- **Modelo de datos:**
  - Tablas nuevas: `event_sources`, `import_suggestions`, `external_people`, `event_guests`, `suppressed_handles`, `sync_runs` y `app_settings`.
  - `events.status` y `attendances.status`.
- **Sección nueva "Importación automática":**
  - Fuentes: Luma calendar y Meetup iCal.
  - Horarios de `pg_cron` y los secretos de vault (`project_url` y `cron_secret`).
  - `CRON_SECRET` en los secretos de las funciones: `supabase secrets set CRON_SECRET=…`.
  - URL de retorno `…/auth/callback**` en Auth.
  - Interruptor `guest_ingest_enabled`.
  - Enlace a `docs/spec-auto-ingest.md`.

---

## Comprobación final

1. `supabase db reset`, y después todas las pruebas SQL de `supabase/tests/`.
2. `cd supabase/functions && deno task test && deno lint`.
3. `cd web && npm run lint && npm run build && node --test tests/*.test.ts`, y `node scripts/test-people.mjs`.
4. Con `npm run dev:local`:
   - `scripts/seed-local-ingest.sql`.
   - `curl` a las tres funciones (con y sin secreto).
5. En el navegador:
   - `/acreditacion` con un usuario de prueba: aviso de detectados, confirmar y descartar.
   - Evento con sombras y "+N asistentes más".
   - `/admin/fuentes`: añadir una URL real de Luma y aceptar o descartar una sugerencia.
   - `/admin/eventos`: "Por revisar", fusionar y publicar.
   - `/admin/sincronizacion`.
   - `/privacidad`.
