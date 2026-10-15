-- Approved on 2026-10-11: 33 additional September–December 2026 events.
-- Excludes the government open AI challenge and Tech for All.
-- Multi-city Qiskit is one event; co-located Torremolinos conferences remain distinct.
-- Explicit, insert-only catalog import. Sources: docs/event-sources.md.
-- Run only on the intended project, never as an automatic deployment seed.
-- Existing IDs (including manual edits) win. No roles or attendance are changed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.orgs, public.events in share row exclusive mode;
create temporary table catalog_source_orgs (like public.orgs including defaults including constraints including indexes) on commit drop;
create temporary table catalog_source_events (like public.events including defaults including constraints including indexes) on commit drop;
insert into catalog_source_orgs (id,name,logo) values
 ('hackbarna','HackBarna','{}'::jsonb),
 ('ai-summit-barcelona','AI Summit Barcelona','{}'::jsonb),
 ('fabric-sql-community','European Microsoft Fabric + SQL Community','{}'::jsonb),
 ('github-community-spain-tech-riders','GitHub Community Spain + Tech Riders','{}'::jsonb),
 ('sovrano-ai','Sovrano AI','{}'::jsonb),
 ('global-legaltech-hub','Global LegalTech Hub','{}'::jsonb),
 ('mcce','Mando Conjunto del Ciberespacio','{}'::jsonb),
 ('gdg-alicante','GDG Alicante','{}'::jsonb),
 ('aimpacto','AImpacto','{}'::jsonb),
 ('microsoft','Microsoft','{}'::jsonb),
 ('startup-valencia','Startup Valencia','{}'::jsonb),
 ('j-on-the-beach','J On The Beach','{}'::jsonb),
 ('lambda-world','Lambda World','{}'::jsonb),
 ('wey-wey-web','Wey Wey Web','{}'::jsonb),
 ('smart-city-expo','Smart City Expo World Congress','{}'::jsonb),
 ('gdg-santiago','GDG Santiago de Compostela','{}'::jsonb),
 ('tech-show-madrid','Tech Show Madrid','{}'::jsonb),
 ('basq-ibm','BasQ + IBM','{}'::jsonb),
 ('pycones','PyConES','{}'::jsonb),
 ('gdg-malaga','GDG Málaga','{}'::jsonb),
 ('devopsdays-barcelona','DevOpsDays Barcelona','{}'::jsonb),
 ('gdg-zaragoza','GDG Zaragoza','{}'::jsonb),
 ('gdg-jerez','GDG Jerez de la Frontera','{}'::jsonb),
 ('indesia','IndesIA','{}'::jsonb),
 ('barcelona-data-ai-product','Barcelona Data and AI Product Management meetup','{}'::jsonb),
 ('gdg-madrid','GDG Madrid','{}'::jsonb),
 ('gdg-cordoba','GDG Córdoba','{}'::jsonb),
 ('congreso-hackers-segovia','Congreso de Hackers de Segovia','{}'::jsonb),
 ('atlas-tecnologico','Atlas Tecnológico','{}'::jsonb),
 ('tech-barcelona','Tech Barcelona','{}'::jsonb),
 ('aesemi','AESEMI','{}'::jsonb),
 ('gdg-lleida','GDG Lleida','{}'::jsonb);

insert into catalog_source_events (id,org_id,name,short,city,starts_on,ends_on,url,kind,color) values
 ('hackbarna-ai-summit-26','hackbarna','HackBarna AI Summit 26','HackBarna','Barcelona','2026-09-19','2026-09-20','https://aisummitbarcelona.com/hackathon','Hackathon','#ff4d00'),
 ('ai-summit-barcelona-26','ai-summit-barcelona','AI Summit Barcelona 2026','AI Summit BCN','Barcelona','2026-09-22','2026-09-23','https://aisummitbarcelona.com/','Conferencia','#ff4d00'),
 ('fabcon-sqlcon-europe-26','fabric-sql-community','FabCon Europe + SQLCon Europe 2026','FabCon + SQLCon','Barcelona','2026-09-28','2026-10-01','https://community.codemotion.com/european-microsoft-fabric-community/meetups/european-microsoft-fabric-community-conference-2026','Conferencia','#ff4d00'),
 ('github-dev-days-madrid-20261001','github-community-spain-tech-riders','GitHub Dev Days Madrid 2026','GitHub Dev Days','Madrid','2026-10-01',null,'https://luma.com/s3r4fn9c','Comunidad','#ff4d00'),
 ('people-behind-ai-madrid-20261001','sovrano-ai','People Behind AI · Madrid','People Behind AI','Madrid','2026-10-01',null,'https://luma.com/57r7xdj3','Comunidad','#ff4d00'),
 ('glthday-26','global-legaltech-hub','GLTHDAY 2026 · Empower the Future','GLTHDAY','Madrid','2026-10-05','2026-10-07','https://luma.com/glthday','Conferencia','#ff4d00'),
 ('talent4cyber-26','mcce','Talent4Cyber 2026','Talent4Cyber','Online','2026-10-14','2026-10-15','https://talent4cyber.es/','Hackathon','#ff4d00'),
 ('devfest-alicante-26','gdg-alicante','DevFest Alicante 2026','DevFest Alicante','San Vicente del Raspeig','2026-10-15',null,'https://gdg.community.dev/events/details/google-gdg-alicante-presents-devfest-2026-alicante/','Conferencia','#ff4d00'),
 ('aimpacto-hackathon-26','aimpacto','AImpacto Hackathon 2026','AImpacto','Madrid','2026-10-16','2026-10-17','https://aimpactorotaract.com/es/events/aimpacto-hackathon-2026/','Hackathon','#ff4d00'),
 ('microsoft-agent-a-thon-barcelona-20261021','microsoft','Microsoft Agent-a-thon Barcelona 2026','Agent-a-thon BCN','Barcelona','2026-10-21',null,'https://info.microsoft.com/SE-CAW-CNTNTO-FY27-09Sep-02-Microsoft-Agent-a-thon-SREVM96098_Catalog-Display-Page.html','Hackathon','#ff4d00'),
 ('vds-26','startup-valencia','VDS 2026','VDS','Valencia','2026-10-21','2026-10-22','https://startupvalencia.org/es/vds/','Conferencia','#ff4d00'),
 ('j-on-the-beach-26','j-on-the-beach','J On The Beach 2026','J On The Beach','Torremolinos','2026-10-29','2026-10-30','https://jonthebeach.com/','Conferencia','#ff4d00'),
 ('lambda-world-26','lambda-world','Lambda World 2026','Lambda World','Torremolinos','2026-10-29','2026-10-30','https://lambda.world/','Conferencia','#ff4d00'),
 ('wey-wey-web-26','wey-wey-web','Wey Wey Web 2026','Wey Wey Web','Torremolinos','2026-10-29','2026-10-30','https://weyweyweb.com/','Frontend','#ff4d00'),
 ('smart-city-expo-26','smart-city-expo','Smart City Expo World Congress 2026','Smart City Expo','Barcelona','2026-11-03','2026-11-05','https://www.smartcityexpo.com/events/smart-city-expo-world-congress/','Conferencia','#ff4d00'),
 ('devfest-santiago-26','gdg-santiago','DevFest Santiago de Compostela 2026','DevFest Santiago','Santiago de Compostela','2026-11-04','2026-11-05','https://gdg.community.dev/events/details/google-gdg-santiago-de-compostela-presents-devfest-santiago-de-compostela-2026/','Conferencia','#ff4d00'),
 ('tech-show-madrid-26','tech-show-madrid','Tech Show Madrid 2026','Tech Show Madrid','Madrid','2026-11-04','2026-11-05','https://www.techshowmadrid.es/','Conferencia','#ff4d00'),
 ('qiskit-fall-fest-basq-26','basq-ibm','Qiskit Fall Fest 2026','Qiskit Fall Fest','Bilbao / Donostia / Vitoria-Gasteiz','2026-11-04','2026-11-06','https://www.basquequantum.eus/index.php/es/eventos/qiskit-fall-fest-2026','Hackathon','#ff4d00'),
 ('pycones-26','pycones','PyConES 2026','PyConES','Barcelona','2026-11-06','2026-11-08','https://pretalx.com/pycones-2026/','Conferencia','#ff4d00'),
 ('biznagafest-26','gdg-malaga','BiznagaFest 2026','BiznagaFest','Málaga','2026-11-07',null,'https://gdg.community.dev/events/details/google-gdg-malaga-presents-biznagafest-2026/','Conferencia','#ff4d00'),
 ('devopsdays-barcelona-26','devopsdays-barcelona','DevOpsDays Barcelona 2026','DevOpsDays BCN','Barcelona','2026-11-13','2026-11-14','https://devopsdays.org/events/2026-barcelona/welcome/','Conferencia','#ff4d00'),
 ('microsoft-agent-a-thon-madrid-20261118','microsoft','Microsoft Agent-a-thon Madrid 2026','Agent-a-thon Madrid','Madrid','2026-11-18',null,'https://info.microsoft.com/SE-CAW-CNTNTO-FY27-09Sep-02-Microsoft-Agent-a-thon-SREVM96098_Catalog-Display-Page.html','Hackathon','#ff4d00'),
 ('devfest-zaragoza-26','gdg-zaragoza','DevFest Zaragoza 2026','DevFest Zaragoza','Zaragoza','2026-11-20',null,'https://gdg.community.dev/events/details/google-gdg-zaragoza-presents-devfest-zaragoza-2026/','Conferencia','#ff4d00'),
 ('devfest-jerez-26','gdg-jerez','DevFest Jerez de la Frontera 2026','DevFest Jerez','Jerez de la Frontera','2026-11-21',null,'https://gdg.community.dev/events/details/google-gdg-jerez-de-la-frontera-presents-devfest-jerez-de-la-frontera/','Conferencia','#ff4d00'),
 ('indesiahack-26','indesia','IndesIAhack 2026','IndesIAhack','Madrid','2026-11-25','2026-11-27','https://indesiahack.org/','Hackathon','#ff4d00'),
 ('designing-ai-products-20261126','barcelona-data-ai-product','Designing AI Products That Fit the Work People Actually Do','Designing AI Products','Online','2026-11-26',null,'https://luma.com/0bi86pqh','Taller','#ff4d00'),
 ('devfest-madrid-26','gdg-madrid','DevFest Madrid 2026','DevFest Madrid','Madrid','2026-11-27',null,'https://gdg.community.dev/events/details/google-gdg-madrid-presents-devfest-madrid-2026/','Conferencia','#ff4d00'),
 ('devfest-cordoba-26','gdg-cordoba','DevFest Córdoba 2026','DevFest Córdoba','Córdoba','2026-11-28',null,'https://gdg.community.dev/events/details/google-gdg-cordoba-presents-devfest-cordoba/','Conferencia','#ff4d00'),
 ('congreso-hackers-segovia-26','congreso-hackers-segovia','III Congreso de Hackers de Segovia 2026','Congreso de Hackers','Segovia','2026-12-01','2026-12-02','https://congresodehackers.es/','Conferencia','#ff4d00'),
 ('collaborate-toledo-26','atlas-tecnologico','Collaborate Toledo 2026 · Aimagine','Collaborate Toledo','Toledo','2026-12-01','2026-12-02','https://atlastecnologico.com/es/noticia/todo-lo-que-tienes-que-saber-sobre-el-collaborate-toledo-2026/','Conferencia','#ff4d00'),
 ('tech-spirit-barcelona-26','tech-barcelona','Tech Spirit Barcelona 2026','Tech Spirit BCN','Barcelona','2026-12-02','2026-12-03','https://www.techbarcelona.com/event/tech-spirit-barcelona-2026/','Conferencia','#ff4d00'),
 ('chipnation-26','aesemi','Chipnation 2026','Chipnation','Barcelona','2026-12-09','2026-12-11','https://chipnation.es/','Conferencia','#ff4d00'),
 ('devfest-lleida-26','gdg-lleida','DevFest Lleida 2026 · Intel·ligència Artesanal','DevFest Lleida','Lleida','2026-12-18',null,'https://www.meetup.com/es-es/flutter-lleida/events/316007168/','Conferencia','#ff4d00');

-- Reuse a manually created organization with the same name and another ID.
-- Ambiguous names require a human to choose; fail atomically rather than guess.
do $$
begin
  if exists (
    select 1 from catalog_source_orgs s
    where not exists (select 1 from public.orgs o where o.id=s.id)
      and (select count(*) from public.orgs o where lower(trim(o.name))=lower(trim(s.name))) > 1
  ) then
    raise exception 'Ambiguous organization names: resolve duplicates before importing';
  end if;
end;
$$;
create temporary table catalog_org_map on commit drop as
select s.id as source_id, coalesce(
  (select o.id from public.orgs o where o.id=s.id),
  (select o.id from public.orgs o where lower(trim(o.name))=lower(trim(s.name)) limit 1),
  s.id
) as target_id
from catalog_source_orgs s;

insert into public.orgs (id,name,logo)
select m.target_id,s.name,s.logo from catalog_source_orgs s
join catalog_org_map m on m.source_id=s.id
on conflict (id) do nothing;

-- Also recognize an existing event entered under a different manual ID.
insert into public.events (id,org_id,name,short,city,starts_on,ends_on,url,kind,color)
select s.id,m.target_id,s.name,s.short,s.city,s.starts_on,s.ends_on,s.url,s.kind,s.color
from catalog_source_events s join catalog_org_map m on m.source_id=s.org_id
where not exists (
  select 1 from public.events e
  where lower(trim(e.city))=lower(trim(s.city)) and e.starts_on=s.starts_on
    and (lower(trim(e.name))=lower(trim(s.name))
         or (s.url is not null and rtrim(e.url,'/')=rtrim(s.url,'/')))
)
on conflict (id) do nothing;
commit;
