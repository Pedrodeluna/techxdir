-- Run against a fresh local stack: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin_panel.sql
-- All fixtures and changes roll back.
begin;

insert into auth.users (id, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000081', '{"name":"Panel admin","user_name":"tp_admin"}'),
  ('00000000-0000-4000-8000-000000000082', '{"name":"Panel user","user_name":"tp_user"}'),
  ('00000000-0000-4000-8000-000000000083', '{"name":"Panel other","user_name":"tp_other"}');
insert into auth.sessions (id, user_id)
values ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000082');

insert into public.app_admins (profile_id) values ('00000000-0000-4000-8000-000000000081');
insert into public.orgs (id, name) values ('test-panel-org', 'Panel test org');

set local role authenticated;

-- A person who is not an admin cannot use the admin functions.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000082', true);
do $$ begin
  begin
    perform public.ban_user('00000000-0000-4000-8000-000000000083', 'spam');
    raise exception 'non-admin banned someone';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.grant_admin('tp_user');
    raise exception 'non-admin granted the admin role';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.app_admins) <> 0 then
    raise exception 'non-admin sees the admin list';
  end if;
end $$;

-- An admin manages any event.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000081', true);
insert into public.events (id, org_id, name, short, city, starts_on, kind)
values ('test-panel-event', 'test-panel-org', 'Panel event', 'Panel', 'Madrid', '2026-10-01', 'Test');
update public.events set city = 'Sevilla' where id = 'test-panel-event';
do $$ begin
  if not exists (select 1 from public.events where id = 'test-panel-event' and city = 'Sevilla')
  then raise exception 'admin could not create and edit an event'; end if;
  if (select count(*) from public.app_admins) < 1 then
    raise exception 'admin cannot see the admin list';
  end if;
end $$;

-- Admin role: grant, and keep at least one.
select public.grant_admin('@tp_other');
select public.revoke_admin('00000000-0000-4000-8000-000000000083');
do $$ begin
  if exists (select 1 from public.app_admins where profile_id = '00000000-0000-4000-8000-000000000083')
  then raise exception 'admin role was not revoked'; end if;
  begin
    perform public.revoke_admin('00000000-0000-4000-8000-000000000081');
    raise exception 'the last admin was revoked';
  exception when check_violation then null;
  end;
end $$;

-- Ban: no self-ban, no admin ban.
do $$ begin
  begin
    perform public.ban_user('00000000-0000-4000-8000-000000000081', 'self');
    raise exception 'admin banned themselves';
  exception when invalid_parameter_value then null;
  end;
end $$;

select public.ban_user('00000000-0000-4000-8000-000000000082', 'Spam en eventos');
reset role;
do $$ begin
  if not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-000000000082' and banned_until = 'infinity')
  then raise exception 'ban did not block sign-in'; end if;
  if exists (select 1 from auth.sessions where user_id = '00000000-0000-4000-8000-000000000082')
  then raise exception 'ban did not end open sessions'; end if;
end $$;
set local role authenticated;

-- A banned person with a valid token writes nothing.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000082', true);
do $$
declare changed integer;
begin
  update public.profiles set bio = 'still here' where id = '00000000-0000-4000-8000-000000000082';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'banned person edited their profile'; end if;
  begin
    insert into public.attendances (profile_id, event_id)
    values ('00000000-0000-4000-8000-000000000082', 'test-panel-event');
    raise exception 'banned person marked attendance';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.grant_admin('tp_user');
    raise exception 'banned person used an admin function';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Other people can still read the banned badge.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000083', true);
do $$ begin
  if not exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-000000000082')
  then raise exception 'banned badge is not public'; end if;
end $$;

-- Unban restores access.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000081', true);
select public.unban_user('00000000-0000-4000-8000-000000000082');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000082', true);
update public.profiles set bio = 'back' where id = '00000000-0000-4000-8000-000000000082';
reset role;
do $$ begin
  if not exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-000000000082' and bio = 'back')
  then raise exception 'unbanned person cannot write'; end if;
  if exists (select 1 from auth.users where id = '00000000-0000-4000-8000-000000000082' and banned_until is not null)
  then raise exception 'unban did not restore sign-in'; end if;
end $$;

-- The admin can delete the event.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000081', true);
delete from public.events where id = 'test-panel-event';
do $$ begin
  if exists (select 1 from public.events where id = 'test-panel-event')
  then raise exception 'admin could not delete an event'; end if;
end $$;

rollback;
