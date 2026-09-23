-- Seed data for local development: real public events, no people.

insert into public.orgs (id, name, logo) values
  ('hackspain', 'HackSpain', '{"mark": "HS", "shape": "square"}'),
  ('commit', 'Commit Conf', '{"mark": "C", "shape": "circle"}'),
  ('t3chfest', 'T3chFest', '{"mark": "T3", "shape": "hex"}'),
  ('bilbostack', 'BilboStack', '{"mark": "BS", "shape": "diamond"}'),
  ('gdg-madrid', 'GDG Madrid', '{"mark": "G", "shape": "ring"}'),
  ('codemotion', 'Codemotion', '{"mark": "CM", "shape": "squircle"}'),
  ('python-es', 'Python España', '{"mark": "Py", "shape": "circle"}'),
  ('lambdaworld', 'Lambda World', '{"mark": "λ", "shape": "hex"}'),
  ('jsday', 'JSDay Canarias', '{"mark": "JS", "shape": "square"}');

insert into public.events (id, org_id, name, short, city, starts_on, ends_on, url, kind, color) values
  ('hackspain-26', 'hackspain', 'HackSpain 2026', 'HackSpain', 'Madrid', '2026-05-09', '2026-05-10', null, 'Hackathon', '#ff3b5c'),
  ('commit-26', 'commit', 'Commit Conf 2026', 'Commit Conf', 'Madrid', '2026-04-24', '2026-04-25', 'https://commitconf.com', 'Conferencia', '#ff8a00'),
  ('t3chfest-26', 't3chfest', 'T3chFest 2026', 'T3chFest', 'Leganés', '2026-03-12', '2026-03-13', 'https://t3chfest.es', 'Conferencia', '#6c5cff'),
  ('bilbostack-26', 'bilbostack', 'BilboStack 2026', 'BilboStack', 'Bilbao', '2026-01-24', null, 'https://bilbostack.com', 'Frontend', '#00b894'),
  ('devfest-mad-25', 'gdg-madrid', 'DevFest Madrid 2025', 'DevFest Madrid', 'Madrid', '2025-11-22', null, null, 'Comunidad', '#1e90ff'),
  ('codemotion-25', 'codemotion', 'Codemotion Madrid 2025', 'Codemotion', 'Madrid', '2025-10-21', '2025-10-22', 'https://www.codemotion.com', 'Conferencia', '#e84393'),
  ('pycones-25', 'python-es', 'PyConES 2025', 'PyConES', 'Sevilla', '2025-10-17', '2025-10-19', 'https://es.pycon.org', 'Python', '#f9c80e'),
  ('lambdaworld-25', 'lambdaworld', 'Lambda World 2025', 'Lambda World', 'Cádiz', '2025-10-02', '2025-10-03', 'https://www.lambda.world', 'Funcional', '#8e44ad'),
  ('jsday-can-25', 'jsday', 'JSDay Canarias 2025', 'JSDay Canarias', 'Tenerife', '2025-09-12', null, 'https://jsdaycanarias.com', 'JavaScript', '#f7df1e'),
  ('pycones-26', 'python-es', 'PyConES 2026', 'PyConES', 'Valencia', '2026-10-09', '2026-10-11', 'https://es.pycon.org', 'Python', '#f9c80e'),
  ('codemotion-26', 'codemotion', 'Codemotion Madrid 2026', 'Codemotion', 'Madrid', '2026-10-20', '2026-10-21', 'https://www.codemotion.com', 'Conferencia', '#e84393'),
  ('devfest-mad-26', 'gdg-madrid', 'DevFest Madrid 2026', 'DevFest Madrid', 'Madrid', '2026-11-21', null, null, 'Comunidad', '#1e90ff'),
  ('hackspain-27', 'hackspain', 'HackSpain 2027', 'HackSpain', 'Barcelona', '2027-04-17', '2027-04-18', null, 'Hackathon', '#ff3b5c');
