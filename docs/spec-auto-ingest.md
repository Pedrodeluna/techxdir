# Especificación · Ingesta automática de eventos y asistentes

Estado: borrador para implementar · 13 de octubre de 2026

## 1. Problema y objetivo

Hoy los eventos se cargan a mano (`supabase/imports/`, `/admin`) y cada persona tiene que marcar su asistencia en la app. Nadie lo va a hacer de forma sostenida, así que la red de contactos queda vacía.

Objetivo: que la app sepa **qué eventos tech hay en España** y **quién va a cada uno** sin que ni el equipo ni los usuarios tengan que introducir datos. El usuario que entra con X solo debe confirmar con un clic los eventos en los que ya le hemos detectado.

## 2. Decisiones tomadas

| Tema | Decisión |
| --- | --- |
| Alcance de eventos | Tech en España, a partir de una lista curada de fuentes. |
| Fuentes v1 | Calendarios de Luma, feeds iCal de Meetup y alta manual pegando una URL de evento de Luma. |
| Quién añade fuentes | Los admins y los gestores de cada organización, para su organización. |
| Publicación | Automática si el evento viene de una fuente curada. Si llega por URL suelta, o se celebra fuera de España, queda en borrador. |
| Asistentes | Se leen de la lista pública de Luma. **Fase A:** `featured_guests` sin iniciar sesión. **Fase B:** si la Fase A se queda corta, una cuenta bot de Luma lee la lista completa. |
| Asistentes sin handle de X | Solo suman al contador. No se guarda nada de ellos. |
| Personas sin cuenta en la app | Perfil sombra con `@handle`, avatar y nombre, que el titular puede reclamar u ocultar. |
| Cruce con usuarios | Por `twitter_handle`, y solo con cuentas que tengan una identidad de X vinculada. Las cuentas de email tienen el handle autodeclarado y no cuentan. |
| Asistencia detectada | Queda **pendiente** hasta que el usuario la confirma. Si la descarta, no vuelve a crearse. |
| Contactos | Las personas sombra aparecen en "gente con la que has coincidido", marcadas como no registradas. |
| Retención | Una persona sombra que nadie reclama se borra 12 meses después de su último evento. Solo se conserva el contador. |
| Login | Se mantiene X OAuth 1.0a, sin pedir el email. El cruce depende únicamente del handle. |
| Ejecución | Supabase Edge Functions programadas con `pg_cron` y `pg_net`. |
| Eventos sueltos (alta por URL) | Se vuelven a leer cada día, igual que los calendarios, hasta que terminan. Después se congelan. |
| Calendarios globales (Claude Community, n8n, ClickHouse…) | Una organización por calendario. La fuente se marca con `country_filter='ES'` y solo entran los eventos en España. |
| Eventos en calendarios "Personal" | El descubrimiento semanal los propone como sugerencia de evento suelto. Un clic en `/admin` los importa. |
| Duplicados | Si coinciden fecha, ciudad y un nombre parecido, el segundo entra en borrador marcado como posible duplicado. Un admin lo fusiona o lo descarta. Luma tiene prioridad sobre Meetup. |

## 3. Qué hay comprobado y qué falta por verificar

Comprobado el 13 de octubre de 2026 con el evento Kernel Panic (`luma.com/p50cydsf`):

- `GET https://api.lu.ma/url?url=<slug>` responde **sin iniciar sesión** con los datos del evento (`event.api_id`, `name`, `start_at` y otros), además de:
  - `event.show_guest_list`;
  - `guest_count` (242 en este caso);
  - `hosts[]`;
  - `featured_guests[]`, una muestra de asistentes con `api_id` (`usr-…`), `name`, `avatar_url`, `username`, `twitter_handle`, `linkedin_handle` y `bio_short`.
- `GET https://api.lu.ma/event/get-guest-list?...` sin sesión responde `"You are not signed in."`.

Pendiente de verificar antes de dar cada fase por cerrada:

1. **Cuántos `featured_guests` devuelve** un evento y qué porcentaje trae `twitter_handle`. Es la métrica que decide si hace falta la Fase B.
2. ~~Endpoint público de los calendarios de Luma.~~ Verificado el 13 de octubre: `GET https://api.lu.ma/calendar/get-items?calendar_api_id=cal-…&period=future|past&pagination_limit=50` funciona sin iniciar sesión y pagina con `has_more`. El `cal-…` se obtiene con `api.lu.ma/url?url=<slug-del-calendario>`.
   - Ojo: Kernel Panic (`p50cydsf`) pertenece a `helmcode`, pero no aparece en el listado de ese calendario. Probablemente sea un evento no listado.
   - Hay que conservar el alta por URL de eventos sueltos y, si se puede, volver a leer esos eventos también.
3. **Si para la lista completa basta con iniciar sesión** o también hay que estar inscrito en el evento. Si exige inscripción, la Fase B tendría que inscribir al bot: ocuparía plaza y el organizador lo vería. Hay que replantearlo antes de construirla.
4. **Formato de `twitter_handle` en Luma.** Puede llegar con `@`, como URL o con mayúsculas. Hay que normalizarlo siempre a `^[A-Za-z0-9_]{1,15}$` en minúsculas.
5. **Que los grupos de Meetup sigan exponiendo `https://www.meetup.com/<grupo>/events/ical/`.**

## 4. Riesgos y mitigaciones obligatorias

Lo que se ha elegido tiene riesgos que hay que asumir de forma explícita:

- **Términos de Luma.** Acceder por su API interna no está soportado. Iniciar sesión con un bot en la Fase B empeora la situación. Pueden bloquear la IP o la cuenta, o enviar un requerimiento.
- **RGPD.** Al crear perfiles sombra tratamos datos de personas que no se han registrado. El artículo 14 nos obliga a informarles, y la base legal tendría que ser el interés legítimo.

Mitigaciones que forman parte del alcance, no son opcionales:

1. **Página de privacidad** (`/privacidad`). Debe explicar qué datos se recogen, de dónde vienen, para qué se usan, durante cuánto tiempo y cómo oponerse.
2. **Opción de ocultarse en cada perfil sombra.** Funciona sin crear cuenta: la persona inicia sesión con X para demostrar que el handle es suyo y su handle pasa a `suppressed_handles`, de forma permanente. También se ofrece un email de contacto.
3. **Datos mínimos.** Solo se guardan handle, nombre, URL del avatar (enlazada a Luma, sin copiar la imagen), `api_id` de Luma y los eventos. No se guardan bio, LinkedIn ni otras redes.
4. **Interruptor general.** `app_settings.guest_ingest_enabled` desactiva la lectura de asistentes sin desplegar nada.
5. **Acceso educado.** Como máximo 1 petición por segundo, un User-Agent identificable, backoff exponencial y nunca más de lo que la lista pública muestra.
6. **Antes de la Fase B**, revisión con un abogado y un registro escrito de la evaluación del interés legítimo.

## 5. Modelo de datos

### 5.1 Tablas nuevas

```sql
-- Fuentes curadas de las que se leen los eventos.
create table public.event_sources (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null references public.orgs (id) on delete cascade,
  kind          text not null check (kind in ('luma_calendar', 'meetup_ical')),
  url           text not null unique,
  external_id   text,                -- cal-… en Luma; urlname del grupo en Meetup
  country_filter text check (country_filter ~ '^[A-Z]{2}$'), -- 'ES' en calendarios globales; null = sin filtro
  enabled       boolean not null default true,
  last_synced_at timestamptz,
  last_error    text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Propuestas del descubrimiento semanal (sección 6). Nunca se importan solas.
create table public.import_suggestions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('luma_calendar', 'luma_event')),
  external_id text not null unique,          -- cal-… o evt-…
  url         text not null,
  name        text not null,
  city        text,
  starts_on   date,                          -- solo en eventos
  found_via   text not null,                 -- p. ej. 'discover:madrid/tech'
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  created_at  timestamptz not null default now()
);

-- Asistentes vistos en Luma que tienen handle de X. Nunca se guardan los que no tienen.
create table public.external_people (
  id            uuid primary key default gen_random_uuid(),
  luma_user_id  text not null unique,          -- usr-…
  handle        text not null check (handle ~ '^[a-z0-9_]{1,15}$'),
  name          text not null default '',
  avatar_url    text,
  profile_id    uuid references public.profiles (id) on delete set null, -- se rellena al cruzarlo con un usuario
  last_seen_on  date not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index external_people_handle_idx on public.external_people (handle);

-- Quién aparece en la lista de Luma de cada evento.
create table public.event_guests (
  event_id      text not null references public.events (id) on delete cascade,
  person_id     uuid not null references public.external_people (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (event_id, person_id)
);

-- Handles que han pedido no aparecer. Nunca se borran.
create table public.suppressed_handles (
  handle     text primary key check (handle ~ '^[a-z0-9_]{1,15}$'),
  created_at timestamptz not null default now()
);

-- Registro de cada ejecución de sincronización, para /admin.
create table public.sync_runs (
  id          bigint generated always as identity primary key,
  job         text not null,                    -- 'sources' | 'guests' | 'retention'
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  stats       jsonb not null default '{}',      -- eventos creados, invitados vistos, cruces, errores
  error       text
);

create table public.app_settings (
  key   text primary key,
  value jsonb not null
);
-- Valores iniciales: guest_ingest_enabled = true, luma_full_list_enabled = false
```

### 5.2 Cambios en las tablas existentes

```sql
alter table public.events
  add column source_id      uuid references public.event_sources (id) on delete set null,
  add column external_kind  text check (external_kind in ('luma', 'meetup')),
  add column external_id    text,                  -- evt-… en Luma; UID del VEVENT en Meetup
  add column status         text not null default 'published' check (status in ('draft', 'published', 'canceled')),
  add column starts_at      timestamptz,           -- hora exacta; starts_on se sigue usando como fecha en Europe/Madrid
  add column guest_count    integer,               -- total según Luma, incluidos los asistentes sin handle
  add column guests_synced_at timestamptz,
  add column guests_frozen  boolean not null default false,
  add column duplicate_of   text references public.events (id) on delete set null; -- posible duplicado pendiente de revisar
create unique index events_external_key on public.events (external_kind, external_id)
  where external_id is not null;

alter table public.attendances
  add column source text not null default 'manual' check (source in ('manual', 'luma')),
  add column status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'dismissed'));
```

- Las asistencias manuales siguen funcionando como ahora: `source='manual'`, `status='confirmed'`.
- Una asistencia `dismissed` se conserva como marca, para que la sincronización no la vuelva a crear. No se muestra en ningún sitio.
- Las políticas RLS del catálogo tienen que filtrar `status = 'published'` para quien no sea admin ni gestor de la organización.

### 5.3 IDs de los eventos importados

Se mantiene el formato legible actual (`hackspain-26`): `slug(nombre)-yy`, con un sufijo numérico si ya existe. La identidad real del evento es `(external_kind, external_id)`. Por eso las importaciones son idempotentes aunque el nombre cambie.

## 6. Sincronización de eventos (`sync-sources`)

La ejecuta `pg_cron` todos los días a las 06:00 (Europe/Madrid). También se lanza al pulsar "Sincronizar ahora" en `/admin`.

Para cada `event_sources` con `enabled = true`:

- **`luma_calendar`.** Se listan los eventos futuros del calendario con el endpoint del punto 3.2. Después se pide el detalle de cada uno con `api.lu.ma/url?url=<slug>`.
- **`meetup_ical`.** Se descarga el iCal y se procesa cada `VEVENT`. Datos: `UID`, `SUMMARY`, `DTSTART`, `DTEND`, `LOCATION` y `URL`.

Cada evento se inserta o actualiza por `(external_kind, external_id)`:

- **Campos que se actualizan siempre:** `name`, `starts_at`, `starts_on`, `ends_on`, `url` y `city`.
  - La ciudad se toma de la geolocalización de Luma, o de `LOCATION` en Meetup.
  - Se normaliza contra una lista de ciudades españolas.
  - Si no se puede determinar, el evento queda en `draft`.
- **Campos que no se tocan si un humano ya los editó:** `short`, `kind` y `color`.
  - Al crear el evento se rellenan con valores por defecto: `short` a partir del nombre, `kind='meetup'` y el `color` de la organización.
- **Eventos fuera de España** (país distinto de ES): se guardan como `draft`.
- **Eventos cancelados en el origen:** `status='canceled'`. No se borran, para no perder asistencias.
- **Eventos que desaparecen del calendario antes de celebrarse:** se marcan como `canceled`.
- **Fuentes con `country_filter`:** se descartan, sin guardarlos, los eventos de otro país.
- **Eventos sueltos** (`external_kind='luma'` y `source_id is null`): en la misma pasada diaria se vuelven a pedir uno a uno con `api.lu.ma/url` mientras no hayan terminado. Se aplican las mismas reglas de actualización y cancelación.
- **Detección de duplicados.** Antes de crear un evento nuevo se buscan eventos con el mismo `starts_on` y la misma `city` y una similitud de nombre alta (`pg_trgm`, `similarity(name) >= 0.5`). Si se encuentra alguno:
  - el evento nuevo entra en `draft` con `duplicate_of` apuntando al existente;
  - si el nuevo viene de Luma y el existente de Meetup, se invierten los papeles, porque Luma tiene prioridad: el de Meetup pasa a duplicado.
  - En `/admin`, "Fusionar" mueve las asistencias al evento principal y borra el duplicado. "No es duplicado" limpia `duplicate_of` y lo publica.

**Sugerencia de fuentes (descubrimiento asistido).** Luma no tiene un listado de "todos los eventos de España". Cada evento pertenece a un calendario, sea personal o de una comunidad. Las páginas de ciudad de Luma (`luma.com/madrid`, `luma.com/barcelona` y `luma.com/malaga`) solo muestran una selección de "populares", de todas las temáticas, y no son exhaustivas. Para ampliar la lista curada sin hacerlo a mano:

- Un job semanal lee esas páginas de ciudad y las categorías Tech/AI, y se queda con los eventos ubicados en España.
- Para cada evento obtiene el calendario al que pertenece y los calendarios de sus hosts, por "bola de nieve".
- Los calendarios que todavía no son fuentes aparecen en `/admin/fuentes` como **sugeridos** (`import_suggestions`, `kind='luma_calendar'`), con botón Aceptar o Descartar. Al aceptar, se elige la organización o se crea una nueva con el nombre del calendario.
- Los eventos que cuelgan de un calendario "Personal" no se pueden seguir como fuente. Se proponen como **evento sugerido** (`kind='luma_event'`). Aceptarlo equivale a darlo de alta por URL.
- Nada de lo sugerido se importa solo. Lo descartado no vuelve a proponerse.

**Alta manual por URL.** En `/admin`, y para los gestores en su organización, se pega una URL de Luma. Se llama a `api.lu.ma/url` y el evento se crea en `draft` dentro de la organización elegida. El admin lo publica. A partir de ahí se mantiene actualizado como evento suelto.

**Lista inicial de fuentes.** Está en `docs/event-sources.md`, en la sección "Calendarios de Luma".

## 7. Sincronización de asistentes (`sync-guests`)

Solo se ejecuta si `guest_ingest_enabled` está activo.

### 7.1 Programación

Cada 6 horas se procesan los eventos de Luma con `status='published'` y `guests_frozen=false` que cumplen:

- empiezan en los próximos 60 días, o
- terminaron hace menos de 24 horas.

Pasadas 24 horas desde el final, una última pasada pone `guests_frozen=true` y ya no se vuelve a leer.

### 7.2 Lectura

- **Fase A.** Se llama a `api.lu.ma/url?url=<slug>` y se leen `guest_count`, `hosts[]` y `featured_guests[]`. Los hosts cuentan como asistentes y se marcan como candidatos a `organizer`.
- **Fase B.** Solo si `luma_full_list_enabled` está activo. Se pagina `event/get-guest-list` con la cookie del bot, guardada en el secreto `LUMA_SESSION` de la Edge Function. Si la cookie caduca: `sync_runs.ok=false`, aviso en `/admin` y se vuelve a la Fase A.

### 7.3 Procesado

Para cada asistente:

1. Se normaliza `twitter_handle`. Si no hay handle, se ignora; solo cuenta en `guest_count`.
2. Si el handle está en `suppressed_handles`, se ignora.
3. Se inserta o actualiza `external_people` por `luma_user_id`: `handle`, `name`, `avatar_url` y `last_seen_on = starts_on`.
4. Se inserta o actualiza `event_guests`.
5. Se lanza el cruce (sección 8).

En la Fase B, quien deja de aparecer en la lista completa se borra de `event_guests` en ese evento: se dio de baja. En la Fase A no se borra nada, porque la muestra va cambiando.

## 8. Cruce con usuarios

### 8.1 Qué cuenta como handle verificado

El de un perfil cuyo usuario tiene una fila en `auth.identities` con proveedor `twitter` (o `x`, si en el futuro se migra a OAuth 2.0). Lo calcula la función `public.verified_handle(profile_id)`, con `security definer`.

### 8.2 Cuándo se cruza

- **En `sync-guests`:** con cada asistente procesado.
- **Al registrarse:** un trigger después del alta de un perfil verificado, o una RPC `claim_detected_attendances()` que se llama en `/auth/callback`. Busca en `external_people` por handle y aplica el cruce a todos sus eventos.

### 8.3 Cómo se cruza

```
external_people.profile_id := profiles.id
para cada event_guests del person:
  insert into attendances (profile_id, event_id, source, status)
  values (…, 'luma', 'pending')
  on conflict do nothing          -- respeta las manuales y las que tengan dismissed
```

Una asistencia manual que ya existía tiene prioridad y no se modifica.

### 8.4 Qué ve el usuario

- **Aviso al entrar:** "Te hemos visto en N eventos". Muestra una lista con Confirmar o Descartar para cada evento, y también Confirmar todos.
  - Confirmar cambia a `status='confirmed'`.
  - Descartar cambia a `status='dismissed'`.
- **Asistencias pendientes:** solo las ve el propio usuario. En la página del evento, mientras siga pendiente, aparece como persona sombra (sección 9). Al confirmar pasa a mostrarse como usuario. Al descartar desaparece también como sombra en ese evento.
- **Hosts de Luma que coinciden con un gestor de la organización:** al confirmar la asistencia, se le asigna `role='organizer'`.

### 8.5 Permisos

El cruce lo hacen funciones `security definer`. Hace falta una política nueva que permita al propio usuario hacer `update` de `status` en sus asistencias, solo de `pending` a `confirmed` o `dismissed`. La política actual solo cubre `insert` y `delete`.

## 9. Personas sombra en la interfaz

- **Página del evento:**
  - Primero los usuarios confirmados.
  - Después las personas sombra, con avatar, nombre, `@handle` y la etiqueta "No está en la app".
  - Al final "+N asistentes más", con N = `guest_count` menos los mostrados.
- **Visibilidad:** la misma que tienen hoy las asistencias, es decir, solo usuarios con sesión iniciada. Las páginas públicas e indexables (`/acreditacion/:handle` y la función de Vercel) **no** muestran personas sombra.
- **En cada persona sombra:**
  - "¿Eres tú?" abre el login con X y, al entrar, lanza el cruce.
  - "Ocultarme" pide login con X para comprobar el handle. Luego añade el handle a `suppressed_handles` y borra sus `external_people` y `event_guests` en cascada. No crea perfil si la persona no lo quiere.
- **Contactos** (`web/src/features/badge/people.ts`): incluyen a las personas sombra con las que el usuario comparte al menos un evento confirmado, marcadas como no registradas.

## 10. Retención (`retention`)

Se ejecuta el día 1 de cada mes:

- Borra las filas de `external_people` con `profile_id is null` y `last_seen_on < current_date - interval '12 months'`. Sus `event_guests` se borran en cascada.
- `events.guest_count` se conserva.
- Borra los `sync_runs` de más de 90 días.

## 11. Panel de administración

En la sección nueva **Fuentes** (`/admin/fuentes`; los gestores ven solo las de su organización):

- Alta de una fuente pegando la URL. El tipo y el `external_id` se detectan solos.
- Activar o pausar la fuente, ver `last_synced_at` y `last_error`, y botón "Sincronizar ahora".

En la sección **Eventos**:

- Filtro de borradores, con botón Publicar.
- Filtro "posibles duplicados", que muestra los dos eventos lado a lado con los botones Fusionar y No es duplicado.
- Bandeja de eventos sugeridos por el descubrimiento.
- Indicador "importado de Luma/Meetup".

En la sección **Sincronización** (solo admins):

- Últimos `sync_runs` con sus estadísticas.
- Interruptores `guest_ingest_enabled` y `luma_full_list_enabled`.
- Cobertura de la Fase A: media de `featured_guests` con handle frente a `guest_count`.

## 12. Infraestructura

- Edge Functions nuevas: `sync-sources`, `sync-guests` y `retention`. Usan la service role y no tienen JWT de usuario. Se invocan desde `pg_cron` mediante `pg_net`, con un secreto compartido en una cabecera.
- Secretos: `CRON_SECRET` y, en la Fase B, `LUMA_SESSION`.
- Extensiones: `pg_cron` y `pg_net`, activadas en una migración.
- Se despliega igual que ahora, con la GitHub Integration de Supabase al hacer merge a `main`.
- Si Luma bloquea las IPs de Supabase, el plan B es mover `sync-guests` a GitHub Actions. La lógica queda en un módulo compartido para facilitar el cambio.

## 13. Fases de entrega

| Fase | Contenido | Criterio de aceptación |
| --- | --- | --- |
| 0 | Verificaciones de la sección 3 y página de privacidad | Respuesta documentada a cada punto, y `/privacidad` publicada. |
| 1 | Migración del modelo de datos, `sync-sources`, alta por URL y sección Fuentes en `/admin` | Con 5 calendarios reales, los eventos aparecen solos a diario sin duplicarse. Reejecutar la sincronización no cambia nada. |
| 2 | `sync-guests` en Fase A, `external_people`, personas sombra en la interfaz y "Ocultarme" | En Kernel Panic se ven los `featured_guests` con handle. "Ocultarme" los elimina para siempre. |
| 3 | Cruce y pendientes: aviso "Te hemos visto", confirmar o descartar, contactos con sombras | Un usuario nuevo que entra con X ve sus eventos detectados y los confirma con un clic. Un descarte no vuelve a aparecer. |
| 4 | Retención y panel de Sincronización | El borrado mensual funciona en local con datos de prueba. |
| 5 (condicional) | Fase B con cuenta bot | Solo si, tras 4 semanas, la cobertura de la Fase A es menor del 30 % de `guest_count`, se ha resuelto el punto 3.3 y hay revisión legal. |

## 14. Métricas

- Eventos importados por semana y porcentaje publicados sin intervención.
- Cobertura de asistentes: personas con handle detectadas entre `guest_count`.
- Usuarios nuevos con al menos un evento detectado al entrar, y porcentaje que confirma.
- Personas sombra reclamadas y ocultadas.

## 15. Fuera de alcance de la v1

- Eventbrite: su API no permite buscar eventos de otros organizadores.
- Asistentes de Meetup: su API exige Pro y ser el organizador.
- Integración oficial con organizadores mediante API key o webhooks de Luma Plus. Sería la vía limpia para quien quiera colaborar, y es candidata a la v2.
- Pedir el email en el login de X para cruzar por email.
- Descubrir eventos fuera de las fuentes curadas.
