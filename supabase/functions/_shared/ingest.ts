// Reads sources and discovery listings and writes them through the
// ingest_* SQL functions. Each run stops when its time budget runs out and
// leaves the rest for the next one.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { cityFromText, normalizeCity } from './cities.ts'
import { type IcalEvent, parseIcal } from './ical.ts'
import { readItnigCalendar } from './itnig.ts'
import { calendarEvents, DISCOVER_PLACES, discoverEvents, type LumaEntry, LumaError, lumaConfig, resolve } from './luma.ts'

export const BUDGET_MS = 110_000
export const deadlineFrom = (start = Date.now()) => start + BUDGET_MS

/** Every function shares one pace for Luma through public.luma_slot(). */
export function useSharedLumaPace(db: SupabaseClient) {
  // Local only: LUMA_API_BASE points at scripts/luma-mock.mjs.
  const base = Deno.env.get('LUMA_API_BASE')
  if (base) lumaConfig.base = base
  lumaConfig.throttle = async () => {
    const { error } = await db.rpc('luma_slot', { gap_ms: lumaConfig.gapMs })
    if (error) throw new Error(`luma_slot: ${error.message}`)
  }
}

const FETCH_HEADERS = { 'User-Agent': 'techxdir-sync/1.0 (+https://github.com/Pedrodeluna/techxdir)' }

export type Source = {
  id: string
  org_id: string
  kind: 'luma_calendar' | 'meetup_ical' | 'itnig_ical'
  url: string
  external_id: string
  country_filter: string | null
}

/** The payload of public.ingest_event(). */
export type EventPayload = {
  external_kind: 'luma' | 'meetup' | 'itnig'
  external_id: string
  name: string
  starts_at: string
  ends_at: string | null
  url: string | null
  /** undefined: the feed has no place (online); null: a place that is not a known city */
  city?: string | null
  country: string | null
  guest_count: number | null
  canceled: boolean
}

export function slugify(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** The date of an instant in Europe/Madrid, as YYYY-MM-DD. */
export const madridDate = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(at)

/** "Noche de IA 2026 · Madrid" on 2026-03-05 → "noche-de-ia-madrid-26". */
export function eventIdBase(name: string, startsAt: string): string {
  const yy = madridDate(new Date(startsAt)).slice(2, 4)
  const words = slugify(name).split('-').filter(word => word && !/^(19|20)\d{2}$/.test(word))
  let base = ''
  for (const word of words) {
    if ((base ? base.length + 1 : 0) + word.length > 40) break
    base = base ? `${base}-${word}` : word
  }
  return `${base || 'evento'}-${yy}`
}

/** A short label for the badge: the name up to 30 characters, cut at a word. */
export function shortName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim()
  if (clean.length <= 30) return clean
  const cut = clean.slice(0, 30)
  const space = cut.lastIndexOf(' ')
  return (space > 12 ? cut.slice(0, space) : cut).replace(/[\s·,:;-]+$/, '')
}

/** "https://www.meetup.com/es-ES/madrid-ai/events/" → "madrid-ai". */
export function meetupGroup(input: string): string | null {
  try {
    const url = new URL(input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`)
    if (!/(^|\.)meetup\.com$/.test(url.hostname)) return null
    const parts = url.pathname.split('/').filter(Boolean)
    const group = /^[a-z]{2}(-[A-Z]{2})?$/.test(parts[0] ?? '') ? parts[1] : parts[0]
    return group && /^[\w-]+$/.test(group) && group !== 'find' ? group : null
  } catch {
    return null
  }
}

export const meetupIcalUrl = (group: string) => `https://www.meetup.com/${group}/events/ical/`

export function fromLuma(entry: LumaEntry): EventPayload {
  const e = entry.event
  const geo = e.geo_address_info ?? {}
  const place = geo.city ?? geo.city_state ?? null
  return {
    external_kind: 'luma',
    external_id: e.api_id,
    name: e.name,
    starts_at: e.start_at,
    ends_at: e.end_at ?? null,
    url: `https://luma.com/${e.url}`,
    city: place ? normalizeCity(place) : undefined,
    country: geo.country_code?.toUpperCase() ?? null,
    guest_count: typeof entry.guest_count === 'number' ? entry.guest_count : null,
    canceled: entry.status === 'canceled' || entry.status === 'cancelled',
  }
}

export function fromIcal(event: IcalEvent, provider: 'meetup' | 'itnig' = 'meetup'): EventPayload {
  const city = cityFromText(event.location)
  return {
    external_kind: provider,
    external_id: event.uid,
    name: event.summary,
    starts_at: event.start.toISOString(),
    ends_at: event.end?.toISOString() ?? null,
    url: event.url,
    city: event.location?.trim() ? city : undefined,
    // These iCalendar feeds do not carry a country. A known Spanish city is enough;
    // an online or unknown place stays as a draft (city null).
    country: city ? 'ES' : null,
    guest_count: null,
    canceled: event.canceled,
  }
}

async function ingest(db: SupabaseClient, payload: EventPayload, src: { id: string | null; org_id: string }) {
  const { data, error } = await db.rpc('ingest_event', {
    payload: {
      ...payload,
      source_id: src.id,
      org_id: src.org_id,
      id_base: eventIdBase(payload.name, payload.starts_at),
      short: shortName(payload.name),
    },
  })
  if (error) throw new Error(`ingest_event ${payload.external_id}: ${error.message}`)
  return data as { id: string; action: 'created' | 'updated' | 'unchanged' | 'skipped'; status: string }
}

/** partial: sources left half done by the deadline; they go first in the next run. */
export type SyncStats = { sources: number; created: number; updated: number; canceled: number; partial: number; errors: string[] }
export const emptyStats = (): SyncStats => ({ sources: 0, created: 0, updated: 0, canceled: 0, partial: 0, errors: [] })

async function readSource(src: Source, deadline: number): Promise<{ events: EventPayload[]; complete: boolean }> {
  if (src.kind === 'luma_calendar') {
    const listing = await calendarEvents(src.external_id, { deadline })
    return {
      events: listing.entries.filter(entry => entry.event?.visibility !== 'private').map(fromLuma),
      complete: listing.complete,
    }
  }
  if (src.kind === 'itnig_ical') {
    return { events: (await readItnigCalendar()).map(event => fromIcal(event, 'itnig')), complete: true }
  }
  const res = await fetch(meetupIcalUrl(src.external_id), { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Meetup ${res.status} on ${src.external_id}`)
  return { events: parseIcal(await res.text()).map(event => fromIcal(event)), complete: true }
}

/**
 * Reads one source and writes its events. Errors are stored on the source.
 * Missing events are canceled only after a complete read, an empty one
 * included. A source cut by the deadline keeps its old last_synced_at, so it
 * is the first one of the next run; the writes are idempotent, so starting
 * it again only costs the reading.
 */
export async function syncSource(db: SupabaseClient, src: Source, stats: SyncStats, deadline = deadlineFrom()) {
  stats.sources++
  try {
    const now = Date.now()
    const read = await readSource(src, deadline)
    const events = read.events
      .filter(e => !src.country_filter || e.country === src.country_filter)
      .filter(e => new Date(e.ends_at ?? e.starts_at).getTime() >= now)
    let complete = read.complete
    const seen: string[] = []
    for (const event of events) {
      if (Date.now() > deadline) {
        complete = false
        break
      }
      const result = await ingest(db, event, src)
      seen.push(event.external_id)
      if (result.action === 'created') stats.created++
      if (result.action === 'updated') stats.updated++
    }
    if (!complete) {
      stats.partial++
      return
    }
    const { data, error } = await db.rpc('cancel_missing_events', { target_source: src.id, seen })
    if (error) throw new Error(error.message)
    stats.canceled += data as number
    await db.from('event_sources').update({ last_synced_at: new Date().toISOString(), last_error: null }).eq('id', src.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stats.errors.push(`${src.url}: ${message}`)
    await db.from('event_sources').update({ last_error: message.slice(0, 500) }).eq('id', src.id)
  }
}

const SOURCE_COLUMNS = 'id, org_id, kind, url, external_id, country_filter'

/** Sources not read in the last 20 hours (or the one asked for), then loose Luma events. */
export async function syncAll(
  db: SupabaseClient,
  opts: { sourceId?: string; force?: boolean; deadline: number },
): Promise<SyncStats & { pending: number }> {
  const stats = emptyStats()
  let query = db.from('event_sources').select(SOURCE_COLUMNS).eq('enabled', true)
  if (opts.sourceId) query = query.eq('id', opts.sourceId)
  else if (!opts.force) {
    query = query.or(`last_synced_at.is.null,last_synced_at.lt.${new Date(Date.now() - 20 * 3600_000).toISOString()}`)
  }
  const { data: sources, error } = await query.order('last_synced_at', { ascending: true, nullsFirst: true })
  if (error) throw new Error(error.message)

  let done = 0
  for (const src of (sources ?? []) as Source[]) {
    if (Date.now() > opts.deadline) break
    await syncSource(db, src, stats, opts.deadline)
    done++
  }
  if (!opts.sourceId && Date.now() < opts.deadline) await refreshLooseEvents(db, stats, opts.deadline)
  return { ...stats, pending: (sources?.length ?? 0) - done }
}

/**
 * Luma events added one by one (no source) that have not ended: the ones
 * read longest ago first, so every run moves on (ingest_event stamps synced_at).
 */
async function refreshLooseEvents(db: SupabaseClient, stats: SyncStats, deadline: number) {
  const now = new Date().toISOString()
  const { data } = await db.from('events')
    .select('id, org_id, url, external_id')
    .eq('external_kind', 'luma').is('source_id', null)
    .in('status', ['draft', 'published'])
    .or(`ends_at.gte.${now},starts_at.gte.${now}`)
    .order('synced_at', { ascending: true, nullsFirst: true }).limit(50)
  for (const row of data ?? []) {
    if (Date.now() > deadline) break
    const slug = String(row.url ?? '').split('/').pop()
    if (!slug) continue
    try {
      const found = await resolve(slug)
      if (found?.kind === 'event') {
        const result = await ingest(db, fromLuma(found.data), { id: null, org_id: row.org_id })
        if (result.action === 'updated') stats.updated++
      } else if (!found) {
        await db.from('events').update({ status: 'canceled', synced_at: now }).eq('id', row.id)
        stats.canceled++
      }
    } catch (error) {
      if (!(error instanceof LumaError)) throw error
      stats.errors.push(`${row.id}: ${error.message}`)
    }
  }
}

/** Weekly discovery on the Luma city pages. Only creates suggestions. */
export async function discover(db: SupabaseClient, deadline: number) {
  const stats = { listed: 0, suggested: 0, errors: [] as string[] }
  const [{ data: sources }, { data: known }] = await Promise.all([
    db.from('event_sources').select('external_id').eq('kind', 'luma_calendar'),
    db.from('events').select('external_id').eq('external_kind', 'luma'),
  ])
  const knownCalendars = new Set((sources ?? []).map(s => s.external_id as string))
  const knownEvents = new Set((known ?? []).map(e => e.external_id as string))

  for (const place of DISCOVER_PLACES) {
    if (Date.now() > deadline) break
    let entries: LumaEntry[]
    try {
      entries = (await discoverEvents(place.id, { deadline })).entries
    } catch (error) {
      stats.errors.push(`${place.city}: ${error instanceof Error ? error.message : error}`)
      continue
    }
    stats.listed += entries.length
    const rows = []
    for (const entry of entries) {
      const cal = entry.calendar
      const event = fromLuma(entry)
      if (cal && !cal.is_personal && cal.slug && !knownCalendars.has(cal.api_id)) {
        knownCalendars.add(cal.api_id)
        rows.push({ kind: 'luma_calendar', external_id: cal.api_id, url: `https://luma.com/${cal.slug}`,
          name: cal.name, city: event.city, starts_on: null, found_via: `discover:${place.city}` })
      } else if ((!cal || cal.is_personal) && !knownEvents.has(event.external_id)) {
        rows.push({ kind: 'luma_event', external_id: event.external_id, url: event.url!, name: event.name,
          city: event.city, starts_on: madridDate(new Date(event.starts_at)), found_via: `discover:${place.city}` })
      }
    }
    if (rows.length) {
      const { data, error } = await db.from('import_suggestions')
        .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: true }).select('id')
      if (error) stats.errors.push(error.message)
      else stats.suggested += data?.length ?? 0
    }
  }
  return stats
}

export type Job = 'sources' | 'discover' | 'guests'

export async function startRun(db: SupabaseClient, job: Job): Promise<number | null> {
  const { data } = await db.from('sync_runs').insert({ job }).select('id').single()
  return (data?.id as number | undefined) ?? null
}

/** A run with errors on some items is not OK: the first one goes to sync_runs.error. */
export async function finishRun(db: SupabaseClient, id: number | null, stats: { errors?: string[] }, error?: string) {
  if (id === null) return
  const itemErrors = stats.errors ?? []
  const first = error ?? (itemErrors.length
    ? `${itemErrors.length} ${itemErrors.length === 1 ? 'error' : 'errores'}: ${itemErrors[0]}`
    : null)
  await db.from('sync_runs').update({
    finished_at: new Date().toISOString(), ok: !first, stats, error: first?.slice(0, 500) ?? null,
  }).eq('id', id)
}
