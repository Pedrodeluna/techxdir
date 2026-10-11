-- Local-only fixtures: five cities with only past test events.
begin;
update public.events
set starts_on = current_date - 14, ends_on = null
where org_id = 'local-demo-events'
  and id in (
    'local-demo-regional-granada',
    'local-demo-regional-cadiz',
    'local-demo-regional-a-coruna',
    'local-demo-regional-vigo',
    'local-demo-regional-santiago'
  );
commit;
