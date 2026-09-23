-- Who runs what.
--
-- Organization managers (org_managers) run an organization: they edit it,
-- create and edit its events, and choose who manages it and who organizes
-- each of its events.
-- Event organizers are attendees with role 'organizer' in attendances: they
-- edit the details of that event.
-- Creating organizations and naming their first manager is done by an admin.

create table public.org_managers (
  org_id     text not null references public.orgs (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (org_id, profile_id)
);
create index org_managers_profile_id_idx on public.org_managers (profile_id);

alter table public.attendances
  add column role text not null default 'attendee' check (role in ('attendee', 'organizer'));

-- Permission checks. Security definer so policies can call them without
-- running into the row level security of the tables they read.
create function public.manages_org(org text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_managers m
    where m.org_id = org and m.profile_id = (select auth.uid())
  );
$$;

create function public.manages_event(event text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.events e
    join public.org_managers m on m.org_id = e.org_id
    where e.id = event and m.profile_id = (select auth.uid())
  );
$$;

create function public.organizes_event(event text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.attendances a
    where a.event_id = event and a.profile_id = (select auth.uid()) and a.role = 'organizer'
  );
$$;

revoke execute on function public.manages_org(text), public.manages_event(text), public.organizes_event(text) from public, anon;
grant execute on function public.manages_org(text), public.manages_event(text), public.organizes_event(text) to authenticated;

-- Column privileges: ids and the org an event belongs to never change from
-- the client. Only managers and organizers pass the policies below.
revoke insert, update on public.orgs from anon, authenticated;
grant update (name, logo) on public.orgs to authenticated;

revoke insert, update on public.events from anon, authenticated;
grant insert (id, org_id, name, short, city, starts_on, ends_on, url, kind, color) on public.events to authenticated;
grant update (name, short, city, starts_on, ends_on, url, kind, color) on public.events to authenticated;

revoke update on public.attendances from anon, authenticated;
grant update (role) on public.attendances to authenticated;

-- org_managers
alter table public.org_managers enable row level security;

create policy "managers are public" on public.org_managers
  for select to anon, authenticated using (true);

create policy "managers add managers" on public.org_managers
  for insert to authenticated with check ((select public.manages_org(org_id)));

create policy "managers remove managers" on public.org_managers
  for delete to authenticated using ((select public.manages_org(org_id)));

-- Managers cannot leave an organization without managers. Admins can, and
-- so can deleting an account.
create function public.keep_one_manager() returns trigger
language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated')
    and exists (select 1 from public.orgs o where o.id = old.org_id)
    and not exists (select 1 from public.org_managers m where m.org_id = old.org_id)
  then
    raise exception 'an organization needs at least one manager' using errcode = '23514';
  end if;
  return old;
end;
$$;

create constraint trigger org_managers_keep_one
  after delete on public.org_managers
  deferrable initially deferred
  for each row execute function public.keep_one_manager();

-- orgs
create policy "managers edit their organization" on public.orgs
  for update to authenticated
  using ((select public.manages_org(id)))
  with check ((select public.manages_org(id)));

-- events
create policy "managers create events" on public.events
  for insert to authenticated with check ((select public.manages_org(org_id)));

create policy "managers and organizers edit events" on public.events
  for update to authenticated
  using ((select public.manages_org(org_id)) or (select public.organizes_event(id)))
  with check ((select public.manages_org(org_id)) or (select public.organizes_event(id)));

create policy "managers delete events" on public.events
  for delete to authenticated using ((select public.manages_org(org_id)));

-- attendances: people can only mark themselves as attendees; managers
-- choose the organizers of their events.
drop policy "people mark their own attendance" on public.attendances;
create policy "people mark their own attendance" on public.attendances
  for insert to authenticated
  with check ((select auth.uid()) = profile_id and role = 'attendee');

create policy "managers add organizers" on public.attendances
  for insert to authenticated with check ((select public.manages_event(event_id)));

create policy "managers change roles" on public.attendances
  for update to authenticated
  using ((select public.manages_event(event_id)))
  with check ((select public.manages_event(event_id)));

create policy "managers remove attendance" on public.attendances
  for delete to authenticated using ((select public.manages_event(event_id)));
