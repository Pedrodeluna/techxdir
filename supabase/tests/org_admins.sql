-- Run against a fresh local stack: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/org_admins.sql
-- All fixtures and changes roll back.
begin;

insert into auth.users (id, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001', '{"name":"Handle squatter","user_name":"elashera"}'),
  ('00000000-0000-4000-8000-000000000002', '{"name":"Real X user","user_name":"elashera"}'),
  ('00000000-0000-4000-8000-000000000003', '{"name":"Event manager","user_name":"manager"}');

-- The claimed profile handle grants nothing. The verified provider identity does.
insert into auth.identities (provider_id, user_id, identity_data, provider)
values ('x-elashera-test', '00000000-0000-4000-8000-000000000002',
        '{"sub":"x-elashera-test","user_name":"elashera"}', 'twitter');

do $$ begin
  if (select count(*) from public.app_admins) <> 1
    or not exists (select 1 from public.app_admins where profile_id = '00000000-0000-4000-8000-000000000002')
  then raise exception 'verified X identity did not receive the only admin grant'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$ begin
  if public.is_app_admin() then raise exception 'handle-only user became admin'; end if;
  begin
    perform public.create_org('forbidden-org', 'Forbidden org', 'manager');
    raise exception 'non-admin created an organization';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$ begin
  if not public.is_app_admin() then raise exception 'verified X user is not admin'; end if;
  perform public.create_org('new-org', 'New organization', 'manager');
  if not exists (select 1 from public.org_managers
                 where org_id = 'new-org' and profile_id = '00000000-0000-4000-8000-000000000003')
  then raise exception 'first manager was not assigned'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
update public.orgs set name = 'Managed organization' where id = 'new-org';
do $$ begin
  if not exists (select 1 from public.orgs where id = 'new-org' and name = 'Managed organization')
  then raise exception 'manager could not edit their organization'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$
declare changed integer;
begin
  update public.orgs set name = 'Stolen organization' where id = 'new-org';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'non-manager edited organization'; end if;
  begin
    insert into public.org_managers (org_id, profile_id)
    values ('new-org', '00000000-0000-4000-8000-000000000001');
    raise exception 'non-manager assigned themselves';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.add_org_manager('new-org', 'elashera');
    raise exception 'non-manager used manager RPC';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
select public.add_org_manager('new-org', 'elashera');
do $$ begin
  if not exists (select 1 from public.org_managers
                 where org_id = 'new-org' and profile_id = '00000000-0000-4000-8000-000000000001')
  then raise exception 'manager could not add a manager'; end if;
end $$;

rollback;
