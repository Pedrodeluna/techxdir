-- Global admins create organizations. Organization managers maintain only
-- their own organizations. Badge "role" remains free-form profile text.
create table public.app_admins (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
grant select on public.app_admins to authenticated;
create policy "admins see their own grant" on public.app_admins
  for select to authenticated using (profile_id = (select auth.uid()));

create function public.is_app_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_admins a where a.profile_id = (select auth.uid())
  );
$$;
revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

-- Bootstrap only the verified X identity @elashera. A profile handle alone
-- is not proof: email sign-ins may choose any unused handle.
insert into public.app_admins (profile_id)
select i.user_id
from auth.identities i
where i.provider in ('twitter', 'x')
  and lower(coalesce(i.identity_data ->> 'user_name', i.identity_data ->> 'preferred_username')) = 'elashera'
on conflict do nothing;

-- If @elashera signs in for the first time after this migration, assign the
-- first grant when Supabase inserts the verified provider identity.
create function public.bootstrap_elashera_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.provider in ('twitter', 'x')
    and lower(coalesce(new.identity_data ->> 'user_name', new.identity_data ->> 'preferred_username')) = 'elashera'
    and not exists (select 1 from public.app_admins)
  then
    insert into public.app_admins (profile_id) values (new.user_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger bootstrap_elashera_admin
  after insert on auth.identities
  for each row execute function public.bootstrap_elashera_admin();

-- Creation and first manager assignment must succeed or fail together.
create function public.create_org(org_id text, org_name text, manager_handle text)
returns public.orgs
language plpgsql security definer set search_path = '' as $$
declare
  manager_id uuid;
  created public.orgs;
begin
  if not public.is_app_admin() then
    raise exception 'only admins can create organizations' using errcode = '42501';
  end if;
  org_id := lower(trim(org_id));
  org_name := trim(org_name);
  manager_handle := lower(trim(both '@' from trim(manager_handle)));
  if org_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(org_id) > 48
    or char_length(org_name) < 2 or char_length(org_name) > 100
  then
    raise exception 'invalid organization id or name' using errcode = '22023';
  end if;
  select p.id into manager_id from public.profiles p
  where lower(p.handle) = manager_handle;
  if manager_id is null then
    raise exception 'manager handle not found' using errcode = '22023';
  end if;
  insert into public.orgs (id, name) values (org_id, org_name)
  returning * into created;
  insert into public.org_managers (org_id, profile_id)
  values (org_id, manager_id);
  return created;
end;
$$;
revoke all on function public.create_org(text, text, text) from public, anon;
grant execute on function public.create_org(text, text, text) to authenticated;

-- Resolve handles in SQL: an underscore in an X handle is literal, whereas
-- a client-side ILIKE lookup would treat it as a wildcard.
create function public.add_org_manager(org text, manager_handle text) returns void
language plpgsql security definer set search_path = '' as $$
declare manager_id uuid;
begin
  if not (public.is_app_admin() or public.manages_org(org)) then
    raise exception 'only admins or managers can assign managers' using errcode = '42501';
  end if;
  select p.id into manager_id from public.profiles p
  where lower(p.handle) = lower(trim(both '@' from trim(manager_handle)));
  if manager_id is null then
    raise exception 'manager handle not found' using errcode = '22023';
  end if;
  insert into public.org_managers (org_id, profile_id) values (org, manager_id);
end;
$$;
revoke all on function public.add_org_manager(text, text) from public, anon;
grant execute on function public.add_org_manager(text, text) to authenticated;

create policy "admins edit organizations" on public.orgs
  for update to authenticated
  using ((select public.is_app_admin()))
  with check ((select public.is_app_admin()));

create policy "admins add managers" on public.org_managers
  for insert to authenticated with check ((select public.is_app_admin()));
create policy "admins remove managers" on public.org_managers
  for delete to authenticated using ((select public.is_app_admin()));

-- The slug never changes. Apply length limits to edits as well as creation.
alter table public.orgs add constraint orgs_name_length
  check (char_length(trim(name)) between 2 and 100);
