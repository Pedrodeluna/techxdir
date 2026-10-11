-- Synthetic UI fixtures. Run ONLY against the local techxdir database.
-- Separate from migrations and the verified public seed; no real attendees.
begin;
insert into public.orgs (id, name, logo)
values ('local-demo-events', 'Laboratorio local · eventos ficticios', '{"mark":"DEV","shape":"square"}')
on conflict (id) do nothing;

insert into public.events (id, org_id, name, short, city, starts_on, ends_on, url, kind, color)
select
  'local-demo-' || cities.slug || '-' || series.n,
  'local-demo-events',
  '[PRUEBA] ' || topics.title || ' · ' || cities.city || ' ' || series.n,
  '[PRUEBA] ' || topics.short,
  cities.city,
  current_date + (series.n - 3) * 12 + cities.offset_days,
  case when series.n % 3 = 0 then current_date + (series.n - 3) * 12 + cities.offset_days + 2 else null end,
  null,
  topics.kind,
  '#111113'
from (values
  ('palma', 'Palma', 0),
  ('ibiza', 'Ibiza', 1),
  ('mahon', 'Mahón', 2),
  ('tenerife', 'Santa Cruz de Tenerife', 3),
  ('gran-canaria', 'Las Palmas de Gran Canaria', 4),
  ('arrecife', 'Arrecife', 5),
  ('madrid', 'Madrid', 6),
  ('barcelona', 'Barcelona', 7),
  ('valencia', 'Valencia', 8),
  ('bilbao', 'Bilbao', 9)
) as cities(slug, city, offset_days)
cross join generate_series(1, 6) as series(n)
join (values
  (1, 'Encuentro de desarrollo web', 'Web', 'Comunidad'),
  (2, 'Taller de accesibilidad y diseño de interfaces', 'Accesibilidad', 'Taller'),
  (3, 'Hackathon de herramientas abiertas', 'Hackathon', 'Hackathon'),
  (4, 'Jornada de datos e inteligencia artificial', 'Datos e IA', 'Conferencia'),
  (5, 'Encuentro de comunidades de software', 'Comunidad', 'Comunidad'),
  (6, 'Laboratorio de aplicaciones móviles y experiencias multiplataforma', 'Apps móviles', 'Taller')
) as topics(n, title, short, kind) on topics.n = series.n
on conflict (id) do nothing;
-- Additional mainland locations for reviewing marker density.
insert into public.events (id, org_id, name, short, city, starts_on, kind)
select 'local-demo-regional-' || slug, 'local-demo-events',
  '[PRUEBA] ' || title || ' · ' || city, '[PRUEBA] ' || short, city,
  current_date + offset_days, kind
from (values
  ('sevilla', 'Sevilla', 'Encuentro de desarrollo web', 'Web', 4, 'Comunidad'),
  ('malaga', 'Málaga', 'Taller de aplicaciones móviles', 'Apps móviles', 7, 'Taller'),
  ('granada', 'Granada', 'Jornada de software abierto', 'Software abierto', -12, 'Conferencia'),
  ('cadiz', 'Cádiz', 'Encuentro de comunidades tech', 'Comunidad', -5, 'Comunidad'),
  ('a-coruna', 'A Coruña', 'Taller de accesibilidad', 'Accesibilidad', -9, 'Taller'),
  ('vigo', 'Vigo', 'Encuentro de datos e IA', 'Datos e IA', -7, 'Comunidad'),
  ('santiago', 'Santiago de Compostela', 'Jornada de desarrollo de software', 'Desarrollo', -8, 'Conferencia')
) as fixtures(slug, city, title, short, offset_days, kind)
on conflict (id) do nothing;
commit;
