-- Kernel Panic, Helmcode: 6 October 2026, Casa del Lector / Matadero Madrid.
-- Sources and organizer announcement: docs/event-sources.md.
-- Explicit insert only. Keep existing records and manual edits on repeat.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.events in share row exclusive mode;
insert into public.events (id,org_id,name,short,city,starts_on,ends_on,url,kind,color)
select 'kernel-panic-madrid-20261006','helmcode','Kernel Panic','Kernel Panic',
       'Madrid','2026-10-06'::date,null,'https://luma.com/p50cydsf','Conferencia','#ff4d00'
where not exists (
  select 1 from public.events e
  where e.id='kernel-panic-madrid-20261006'
     or e.url='https://luma.com/p50cydsf'
     or (lower(trim(e.name))='kernel panic' and lower(trim(e.city))='madrid'
         and e.starts_on='2026-10-06')
)
on conflict (id) do nothing;
commit;
