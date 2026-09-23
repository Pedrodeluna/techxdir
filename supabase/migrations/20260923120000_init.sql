-- techxdir: profiles, organizations, events and attendance.
-- A person's contacts are derived from shared attendance, so there is no
-- follow table.

-- Organizations run one or more events.
create table public.orgs (
  id   text primary key,
  name text not null,
  -- { "mark": "HS", "shape": "square" } or an image URL string
  logo jsonb not null default '{}'::jsonb
);

create table public.events (
  id        text primary key,
  org_id    text not null references public.orgs (id) on delete cascade,
  name      text not null,
  short     text not null,
  city      text not null,
  starts_on date not null,
  ends_on   date,
  url       text,
  kind      text not null,
  color     text not null default '#111113',
  check (ends_on is null or ends_on >= starts_on)
);
create index events_org_id_idx on public.events (org_id);
create index events_starts_on_idx on public.events (starts_on);

-- One row per signed-in person. Created by the trigger below.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null default '' check (char_length(name) <= 40),
  handle     text check (handle ~ '^[A-Za-z0-9_]{1,15}$'),
  role       text not null default '' check (char_length(role) <= 40),
  company    text not null default '' check (char_length(company) <= 30),
  bio        text not null default '' check (char_length(bio) <= 160),
  photo_url  text,
  joined     smallint not null default extract(year from now())::smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- X handles are case-insensitive
create unique index profiles_handle_key on public.profiles (lower(handle));

create table public.attendances (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  event_id   text not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, event_id)
);
create index attendances_event_id_idx on public.attendances (event_id);

-- Keep updated_at current.
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- First sign-in creates the badge. X sign-ins bring name and handle; email
-- sign-ins complete them on /auth/callback.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wanted text := coalesce(meta ->> 'user_name', meta ->> 'preferred_username');
begin
  insert into public.profiles (id, name, handle, photo_url)
  values (
    new.id,
    left(coalesce(meta ->> 'name', meta ->> 'full_name', ''), 40),
    case
      when wanted ~ '^[A-Za-z0-9_]{1,15}$'
        and not exists (select 1 from public.profiles p where lower(p.handle) = lower(wanted))
      then wanted
    end,
    meta ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row level security
alter table public.orgs enable row level security;
alter table public.events enable row level security;
alter table public.profiles enable row level security;
alter table public.attendances enable row level security;

create policy "orgs are public" on public.orgs
  for select to anon, authenticated using (true);

create policy "events are public" on public.events
  for select to anon, authenticated using (true);

create policy "profiles are public" on public.profiles
  for select to anon, authenticated using (true);

create policy "people update their own profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "attendance is visible to signed-in people" on public.attendances
  for select to authenticated using (true);

create policy "people mark their own attendance" on public.attendances
  for insert to authenticated with check ((select auth.uid()) = profile_id);

create policy "people unmark their own attendance" on public.attendances
  for delete to authenticated using ((select auth.uid()) = profile_id);
