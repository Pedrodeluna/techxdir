-- Verified public events: September–October 2026. Sources: docs/event-sources.md.
-- Insert-only local seed: preserve manual changes when run again.
-- Never invent attendees or organizer permissions.
insert into public.orgs (id, name, logo) values
 ('hackspain','HackSpain','{"mark":"HS","shape":"square"}'),
 ('helmcode','Helmcode','{"mark":"H","shape":"circle"}'),
 ('react-alicante','React Alicante','{"mark":"RA","shape":"hex"}'),
 ('grok-madrid','Grok Madrid community','{"mark":"G","shape":"ring"}'),
 ('edd','Extremadura Digital Day','{"mark":"ED","shape":"square"}'),
 ('software-crafters-bcn','Software Crafters Barcelona','{"mark":"SC","shape":"diamond"}'),
 ('trgcon','TRGCON','{"mark":"TRG","shape":"squircle"}')
on conflict (id) do nothing;

insert into public.events (id, org_id, name, short, city, starts_on, ends_on, url, kind, color) values
 ('hackspain-26','hackspain','HackSpain 2026','HackSpain','Madrid','2026-09-18','2026-09-20','https://hackspain.com/','Hackathon','#ff4d00'),
 ('cafe-helmcode-madrid-20260922','helmcode','Café Helmcode Madrid','Café Helmcode','Madrid','2026-09-22',null,'https://www.madtechcampus.com/noticias/2026-09-22-cafe-helmcode-madrid/','Comunidad','#ff4d00'),
 ('react-alicante-26','react-alicante','React Alicante 2026','React Alicante','Alicante','2026-09-24','2026-09-26','https://reactalicante.es/','Frontend','#ff4d00'),
 ('grok-bot-madrid-20260929','grok-madrid','Grok Bot Madrid Meetup','Grok Madrid','Madrid','2026-09-29',null,'https://luma.com/grokbotmadrid1','Taller','#ff4d00'),
 ('edd-26','edd','Extremadura Digital Day 2026','EDD','Cáceres','2026-10-03',null,'https://extremaduradigitalday.com/','Comunidad','#ff4d00'),
 ('software-crafters-bcn-26','software-crafters-bcn','Software Crafters Barcelona 2026','SCBCN','Barcelona','2026-10-16','2026-10-17','https://softwarecrafters.barcelona/','Conferencia','#ff4d00'),
 ('trgcon-26','trgcon','TRGCON 2026 · TarugoConf','TRGCON','Madrid','2026-10-22','2026-10-24','https://www.trgcon.com/','Conferencia','#ff4d00')
on conflict (id) do nothing;
