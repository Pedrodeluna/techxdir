-- Admin panel: admins manage every event, grant and revoke the admin role,
-- and ban people.
--
-- A ban stops sign-in (auth.users.banned_until), ends open sessions, and
-- makes the database refuse every write from the banned person while their
-- last access token is still valid. The badge stays public.

-- Admins see the full list of admins.
create policy "admins see all admins" on public.app_admins
  for select to authenticated using ((select public.is_app_admin()));

-- Admins manage every event, not only the events of organizations they run.
create policy "admins create events" on public.events
  for insert to authenticated with check ((select public.is_app_admin()));

create policy "admins edit events" on public.events
  for update to authenticated
  using ((select public.is_app_admin()))
  with check ((select public.is_app_admin()));

create policy "admins delete events" on public.events
  for delete to authenticated using ((select public.is_app_admin()));

-- Admin role. At least one admin always remains.
create function public.grant_admin(admin_handle text) returns void
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if not public.is_app_admin() then
    raise exception 'only admins can grant the admin role' using errcode = '42501';
  end if;
  select p.id into target from public.profiles p
  where lower(p.handle) = lower(trim(both '@' from trim(admin_handle)));
  if target is null then
    raise exception 'handle not found' using errcode = '22023';
  end if;
  if exists (select 1 from public.bans b where b.profile_id = target) then
    raise exception 'banned people cannot be admins' using errcode = '22023';
  end if;
  insert into public.app_admins (profile_id) values (target);
end;
$$;

create function public.revoke_admin(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_app_admin() then
    raise exception 'only admins can revoke the admin role' using errcode = '42501';
  end if;
  delete from public.app_admins where profile_id = target;
  if not exists (select 1 from public.app_admins) then
    raise exception 'at least one admin must remain' using errcode = '23514';
  end if;
end;
$$;

-- Bans
create table public.bans (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  reason     text not null default '' check (char_length(reason) <= 200),
  banned_by  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.bans enable row level security;
revoke all on public.bans from anon, authenticated;
grant select on public.bans to authenticated;
create policy "admins see bans" on public.bans
  for select to authenticated using ((select public.is_app_admin()));

create function public.is_banned() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bans b where b.profile_id = (select auth.uid())
  );
$$;
revoke all on function public.is_banned() from public, anon;
grant execute on function public.is_banned() to authenticated;

create function public.ban_user(target uuid, ban_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_app_admin() then
    raise exception 'only admins can ban people' using errcode = '42501';
  end if;
  if target = (select auth.uid()) then
    raise exception 'admins cannot ban themselves' using errcode = '22023';
  end if;
  if exists (select 1 from public.app_admins a where a.profile_id = target) then
    raise exception 'admins cannot be banned' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target) then
    raise exception 'profile not found' using errcode = '22023';
  end if;
  insert into public.bans (profile_id, reason, banned_by)
  values (target, left(trim(coalesce(ban_reason, '')), 200), (select auth.uid()))
  on conflict (profile_id) do update set reason = excluded.reason, banned_by = excluded.banned_by;
  update auth.users set banned_until = 'infinity' where id = target;
  -- Refresh tokens belong to sessions and go with them.
  delete from auth.sessions where user_id = target;
end;
$$;

create function public.unban_user(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_app_admin() then
    raise exception 'only admins can unban people' using errcode = '42501';
  end if;
  delete from public.bans where profile_id = target;
  update auth.users set banned_until = null where id = target;
end;
$$;

revoke all on function public.grant_admin(text), public.revoke_admin(uuid),
  public.ban_user(uuid, text), public.unban_user(uuid) from public, anon;
grant execute on function public.grant_admin(text), public.revoke_admin(uuid),
  public.ban_user(uuid, text), public.unban_user(uuid) to authenticated;

-- A banned person writes nothing. Restrictive policies apply on top of every
-- permissive policy of the table.
create policy "banned people cannot write" on public.profiles
  as restrictive for update to authenticated using (not (select public.is_banned()));

create policy "banned people cannot add attendance" on public.attendances
  as restrictive for insert to authenticated with check (not (select public.is_banned()));
create policy "banned people cannot change attendance" on public.attendances
  as restrictive for update to authenticated using (not (select public.is_banned()));
create policy "banned people cannot remove attendance" on public.attendances
  as restrictive for delete to authenticated using (not (select public.is_banned()));

create policy "banned people cannot edit organizations" on public.orgs
  as restrictive for update to authenticated using (not (select public.is_banned()));

create policy "banned people cannot create events" on public.events
  as restrictive for insert to authenticated with check (not (select public.is_banned()));
create policy "banned people cannot edit events" on public.events
  as restrictive for update to authenticated using (not (select public.is_banned()));
create policy "banned people cannot delete events" on public.events
  as restrictive for delete to authenticated using (not (select public.is_banned()));

create policy "banned people cannot add managers" on public.org_managers
  as restrictive for insert to authenticated with check (not (select public.is_banned()));
create policy "banned people cannot remove managers" on public.org_managers
  as restrictive for delete to authenticated using (not (select public.is_banned()));

-- Security definer functions skip row level security, so they check too.
create or replace function public.add_org_manager(org text, manager_handle text) returns void
language plpgsql security definer set search_path = '' as $$
declare manager_id uuid;
begin
  if public.is_banned() or not (public.is_app_admin() or public.manages_org(org)) then
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
