-- Extend the existing importer without changing Luma/Meetup identity rules.
alter table public.event_sources drop constraint event_sources_kind_check;
alter table public.event_sources add constraint event_sources_kind_check
  check (kind in ('luma_calendar', 'meetup_ical', 'itnig_ical'));
alter table public.events drop constraint events_external_kind_check;
alter table public.events add constraint events_external_kind_check
  check (external_kind in ('luma', 'meetup', 'itnig'));

-- Ignore tracking parameters and the optional slash/www alias, not the event ID.
create function public.itnig_event_key(value text) returns text
language sql immutable strict set search_path = '' as $$
  select substring(value from '^https?://(?:www\.)?itnig\.net/events/([A-Za-z0-9_-]+)/?(?:[?#].*)?$');
$$;
revoke all on function public.itnig_event_key(text) from public;

create or replace function public.ingest_event(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_kind     text := payload ->> 'external_kind';
  v_ext      text := payload ->> 'external_id';
  v_org      text := payload ->> 'org_id';
  v_abroad   boolean;
  v_place_ok boolean;
  v_name     text := left(btrim(payload ->> 'name'), 120);
  v_starts   timestamptz := (payload ->> 'starts_at')::timestamptz;
  v_ends     timestamptz := nullif(payload ->> 'ends_at', '')::timestamptz;
  v_from     date;
  v_to       date;
  v_city     text := nullif(btrim(payload ->> 'city'), '');
  v_country  text := nullif(payload ->> 'country', '');
  v_source   uuid := nullif(payload ->> 'source_id', '')::uuid;
  v_canceled boolean := coalesce((payload ->> 'canceled')::boolean, false);
  v_guests   integer := nullif(payload ->> 'guest_count', '')::integer;
  v_url      text := nullif(payload ->> 'url', '');
  v_found    public.events;
  v_twin     public.events;
  v_dup      text;
  v_status   text;
  v_base     text;
  v_id       text;
  v_n        integer := 1;
  v_changed  integer;
  v_matches  integer;
begin
  if v_kind is null or v_ext is null or v_org is null or coalesce(v_name, '') = '' or v_starts is null then
    raise exception 'ingest_event needs external_kind, external_id, org_id, name and starts_at' using errcode = '22023';
  end if;
  v_abroad := coalesce(v_country, 'ES') <> 'ES';
  v_from := (v_starts at time zone 'Europe/Madrid')::date;
  v_to := (v_ends at time zone 'Europe/Madrid')::date;
  if v_to is not null and v_to <= v_from then
    v_to := null;
  end if;

  select * into v_found from public.events e where e.external_kind = v_kind and e.external_id = v_ext;
  if found then
    if v_found.org_id <> v_org then
      return jsonb_build_object('id', v_found.id, 'action', 'skipped', 'status', v_found.status, 'reason', 'other_org');
    end if;
    if v_found.status = 'merged' then
      return jsonb_build_object('id', v_found.id, 'action', 'skipped', 'status', 'merged');
    end if;
    -- An unresolved city keeps the stored one (it may have been fixed by
    -- hand) but is not enough to publish again a canceled event.
    v_place_ok := not v_abroad and coalesce(v_city, nullif(v_found.city, '')) is not null
      and not (payload ? 'city' and v_city is null);
    v_status := case
      when v_canceled then 'canceled'
      when v_found.status = 'published' and v_abroad then 'draft'   -- moved out of Spain
      when v_found.status = 'canceled' then
        case when v_found.source_id is not null and v_found.duplicate_of is null and v_place_ok
          then 'published' else 'draft' end
      else v_found.status
    end;
    update public.events e set
      name = v_name, starts_at = v_starts, ends_at = v_ends, starts_on = v_from, ends_on = v_to,
      url = coalesce(v_url, e.url), city = coalesce(v_city, e.city),
      source_id = coalesce(v_source, e.source_id), guest_count = coalesce(v_guests, e.guest_count),
      status = v_status
    where e.id = v_found.id
      and (e.name, e.starts_at, e.ends_at, e.starts_on, e.ends_on, e.url, e.city, e.source_id, e.guest_count, e.status)
        is distinct from
          (v_name, v_starts, v_ends, v_from, v_to, coalesce(v_url, e.url), coalesce(v_city, e.city),
           coalesce(v_source, e.source_id), coalesce(v_guests, e.guest_count), v_status);
    get diagnostics v_changed = row_count;
    update public.events e set synced_at = now() where e.id = v_found.id;
    return jsonb_build_object('id', v_found.id, 'action', case when v_changed > 0 then 'updated' else 'unchanged' end,
      'status', v_status);
  end if;

  -- Adoption: an event entered by hand (catalog import or admin) has no
  -- external id, so the first sync would add it again. When the organization
  -- has exactly one such event that day, the incoming one takes it over and
  -- fixes its name and link, which may have changed since (the name is not
  -- compared for that reason). Itnig instead requires the same canonical
  -- event URL, even across date changes; never adopt by day alone for Itnig.
  select count(*) into v_matches from public.events e
  where e.org_id = v_org and e.external_id is null
    and case when v_kind = 'itnig' then
      public.itnig_event_key(e.url) = public.itnig_event_key(v_url)
    else e.starts_on = v_from end
    and e.status in ('draft', 'published');
  if v_kind = 'itnig' and v_matches > 1 then
    raise exception 'Ambiguous Itnig event URL: %', v_url using errcode = '22023';
  end if;
  if v_matches = 1 then
    select * into v_found from public.events e
    where e.org_id = v_org and e.external_id is null
    and case when v_kind = 'itnig' then
      public.itnig_event_key(e.url) = public.itnig_event_key(v_url)
    else e.starts_on = v_from end
      and e.status in ('draft', 'published');
    update public.events e set
      external_kind = v_kind, external_id = v_ext,
      name = v_name, short = left(coalesce(nullif(btrim(payload ->> 'short'), ''), v_name), 30),
      starts_at = v_starts, ends_at = v_ends, starts_on = v_from, ends_on = v_to,
      url = coalesce(v_url, e.url), city = coalesce(v_city, e.city),
      source_id = coalesce(v_source, e.source_id), guest_count = coalesce(v_guests, e.guest_count),
      status = case when v_canceled then 'canceled' else e.status end,
      synced_at = now()
    where e.id = v_found.id;
    return jsonb_build_object('id', v_found.id, 'action', 'updated', 'adopted', true,
      'status', case when v_canceled then 'canceled' else v_found.status end);
  end if;

  -- Possible duplicate: same day, same city, similar name. Luma wins over a
  -- Meetup copy of the same organization; across organizations the newcomer
  -- waits as a draft and the existing event is left alone.
  if v_city is not null then
    select d.* into v_twin from public.events d
    where d.starts_on = v_from and lower(d.city) = lower(v_city)
      and d.status in ('draft', 'published') and d.duplicate_of is null
      and extensions.similarity(lower(d.name), lower(v_name)) >= 0.5
    order by extensions.similarity(lower(d.name), lower(v_name)) desc
    limit 1;
  end if;
  if v_twin.id is not null
    and not (v_kind = 'luma' and v_twin.external_kind is not distinct from 'meetup' and v_twin.org_id = v_org)
  then
    v_dup := v_twin.id;
  end if;

  v_status := case
    when v_canceled then 'canceled'
    when v_source is null or v_city is null or v_abroad or v_dup is not null then 'draft'
    else 'published'
  end;

  v_base := rtrim(left(coalesce(nullif(payload ->> 'id_base', ''), ''), 44), '-');
  if v_base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    v_base := 'evento-' || to_char(v_from, 'YY');
  end if;
  v_id := v_base;
  while exists (select 1 from public.events e where e.id = v_id) loop
    v_n := v_n + 1;
    v_id := v_base || '-' || v_n;
  end loop;

  insert into public.events (id, org_id, name, short, city, starts_on, ends_on, url, kind, color,
    source_id, external_kind, external_id, status, starts_at, ends_at, guest_count, duplicate_of, synced_at)
  values (
    v_id, v_org, v_name,
    left(coalesce(nullif(btrim(payload ->> 'short'), ''), v_name), 30),
    coalesce(v_city, ''), v_from, v_to, v_url, 'Meetup',
    coalesce((select x.color from public.events x where x.org_id = v_org order by x.starts_on desc limit 1), '#111113'),
    v_source, v_kind, v_ext, v_status, v_starts, v_ends, v_guests, v_dup, now()
  );

  if v_twin.id is not null and v_dup is null then
    update public.events set status = 'draft', duplicate_of = v_id
    where id = v_twin.id and org_id = v_org and status in ('draft', 'published');
  end if;

  return jsonb_build_object('id', v_id, 'action', 'created', 'status', v_status, 'duplicate_of', v_dup);
end;
$$;
