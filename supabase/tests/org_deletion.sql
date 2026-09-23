-- Run against local Supabase with psql; all fixtures and deletes roll back.
begin;

insert into auth.users (id, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000091', '{"name":"Deletion admin","user_name":"test_delete_admin"}'),
  ('00000000-0000-4000-8000-000000000092', '{"name":"Deletion manager","user_name":"test_delete_mgr"}'),
  ('00000000-0000-4000-8000-000000000093', '{"name":"Deletion attendee","user_name":"test_delete_att"}');

insert into public.app_admins (profile_id) values ('00000000-0000-4000-8000-000000000091');
insert into public.orgs (id, name) values ('test-delete-org', 'Deletion test org');
insert into public.org_managers (org_id, profile_id)
values ('test-delete-org', '00000000-0000-4000-8000-000000000092');
insert into public.events (id, org_id, name, short, city, starts_on, kind)
values ('test-delete-event', 'test-delete-org', 'Deletion test event', 'Delete', 'Madrid', '2026-09-23', 'Test');
insert into public.attendances (profile_id, event_id)
values ('00000000-0000-4000-8000-000000000093', 'test-delete-event');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000092', true);
do $$ declare deleted integer; begin
  update public.orgs set name = 'Edited by manager', logo = '{"mark":"DM","shape":"circle"}'
  where id = 'test-delete-org';
  if not exists (select 1 from public.orgs where id = 'test-delete-org'
    and name = 'Edited by manager' and logo ->> 'mark' = 'DM')
  then raise exception 'manager could not edit organization'; end if;
  delete from public.orgs where id = 'test-delete-org';
  get diagnostics deleted = row_count;
  if deleted <> 0 then raise exception 'manager deleted organization'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000093', true);
do $$ declare deleted integer; begin
  update public.orgs set name = 'Stolen name' where id = 'test-delete-org';
  get diagnostics deleted = row_count;
  if deleted <> 0 then raise exception 'attendee edited organization'; end if;
  delete from public.orgs where id = 'test-delete-org';
  get diagnostics deleted = row_count;
  if deleted <> 0 then raise exception 'attendee deleted organization'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000091', true);
do $$ declare deleted integer; begin
  update public.orgs set logo = '"https://example.com/logo.png"' where id = 'test-delete-org';
  if not exists (select 1 from public.orgs where id = 'test-delete-org'
    and logo = '"https://example.com/logo.png"'::jsonb)
  then raise exception 'admin could not edit logo'; end if;
  delete from public.orgs where id = 'test-delete-org';
  get diagnostics deleted = row_count;
  if deleted <> 1 then raise exception 'admin could not delete organization'; end if;
end $$;

reset role;
do $$ begin
  if exists (select 1 from public.events where id = 'test-delete-event')
    or exists (select 1 from public.attendances where event_id = 'test-delete-event')
    or exists (select 1 from public.org_managers where org_id = 'test-delete-org')
  then raise exception 'organization deletion did not cascade'; end if;
end $$;

rollback;
