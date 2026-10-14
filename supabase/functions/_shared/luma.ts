// Client for Luma's public web endpoints (api.lu.ma), used without a key.
// One request at a time with a pause between them, and retries on 429/5xx.
// In the Edge Functions the pause is shared by every run through
// public.luma_slot() (see useSharedLumaPace in ingest.ts).

export const lumaConfig: {
  gapMs: number
  retryMs: number
  timeoutMs: number
  base: string
  /** Waits for the turn to call Luma; null = a pause kept in this instance. */
  throttle: (() => Promise<void>) | null
} = { gapMs: 1000, retryMs: 2000, timeoutMs: 15_000, base: 'https://api.lu.ma', throttle: null }

const USER_AGENT = 'techxdir-sync/1.0 (+https://github.com/Pedrodeluna/techxdir)'

export class LumaError extends Error {
  constructor(readonly status: number, path: string) {
    super(`Luma ${status} on ${path}`)
  }
}

let last = 0
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function lumaGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${lumaConfig.base}/${path}?${new URLSearchParams(params)}`
  for (let attempt = 0; ; attempt++) {
    if (lumaConfig.throttle) await lumaConfig.throttle()
    else {
      const pause = last + lumaConfig.gapMs - Date.now()
      if (pause > 0) await wait(pause)
      last = Date.now()
    }
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(lumaConfig.timeoutMs),
    })
    if (res.ok) return await res.json() as T
    await res.body?.cancel()
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await wait(lumaConfig.retryMs * 2 ** attempt)
      continue
    }
    throw new LumaError(res.status, path)
  }
}

export type LumaPerson = {
  api_id: string
  name?: string | null
  avatar_url?: string | null
  twitter_handle?: string | null
}

export type LumaEvent = {
  api_id: string
  name: string
  start_at: string
  end_at?: string | null
  timezone?: string | null
  url: string
  visibility?: string | null
  geo_address_info?: { city?: string | null; country_code?: string | null; city_state?: string | null } | null
}

export type LumaCalendar = {
  api_id: string
  name: string
  slug?: string | null
  is_personal?: boolean
}

/** One item of a calendar or discovery listing, and the data of /url for an event. */
export type LumaEntry = {
  api_id?: string
  event: LumaEvent
  calendar?: LumaCalendar | null
  guest_count?: number | null
  hosts?: LumaPerson[] | null
  featured_guests?: LumaPerson[] | null
  status?: string | null
}

export type Resolved =
  | { kind: 'event'; data: LumaEntry }
  | { kind: 'calendar'; data: { calendar: LumaCalendar } }

/** The slug of a luma.com / lu.ma URL, or the value itself when it already is one. */
export function lumaSlug(input: string): string | null {
  const value = input.trim()
  if (/^[\w-]+$/.test(value)) return value
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`)
    if (!/(^|\.)(luma\.com|lu\.ma)$/.test(url.hostname)) return null
    const slug = url.pathname.split('/').filter(Boolean)[0]
    return slug && /^[\w-]+$/.test(slug) ? slug : null
  } catch {
    return null
  }
}

export async function resolve(slug: string): Promise<Resolved | null> {
  try {
    const res = await lumaGet<{ kind: string; data: unknown }>('url', { url: slug })
    if (res.kind === 'event' || res.kind === 'calendar') return res as Resolved
    return null
  } catch (error) {
    if (error instanceof LumaError && error.status === 404) return null
    throw error
  }
}

type Page = { entries: LumaEntry[]; has_more?: boolean; next_cursor?: string | null }

/** complete is false when the listing was cut by maxPages or the deadline. */
export type Listing = { entries: LumaEntry[]; complete: boolean }
type ListOptions = { maxPages?: number; deadline?: number }

async function paginate(path: string, params: Record<string, string>, opts: Required<ListOptions>): Promise<Listing> {
  const entries: LumaEntry[] = []
  let cursor: string | null = null
  for (let page = 0; page < opts.maxPages; page++) {
    if (Date.now() > opts.deadline) return { entries, complete: false }
    const res: Page = await lumaGet<Page>(path, {
      ...params,
      pagination_limit: '50',
      ...(cursor ? { pagination_cursor: cursor } : {}),
    })
    entries.push(...(res.entries ?? []))
    cursor = res.next_cursor ?? null
    if (!res.has_more || !cursor) return { entries, complete: true }
  }
  return { entries, complete: false }
}

/** Upcoming events of a calendar. Entries already carry hosts, featured guests and guest_count. */
export const calendarEvents = (calendarId: string, { maxPages = 20, deadline = Infinity }: ListOptions = {}) =>
  paginate('calendar/get-items', { calendar_api_id: calendarId, period: 'future' }, { maxPages, deadline })

/** Upcoming events of a Luma city page. */
export const discoverEvents = (placeId: string, { maxPages = 3, deadline = Infinity }: ListOptions = {}) =>
  paginate('discover/get-paginated-events', { discover_place_api_id: placeId }, { maxPages, deadline })

export const DISCOVER_PLACES: { id: string; city: string }[] = [
  { id: 'discplace-03jiEcS4mvwJuDa', city: 'madrid' },
  { id: 'discplace-WcS4REeayDPXV4n', city: 'barcelona' },
]

/** A Luma twitter_handle (sometimes a URL or with @) as a valid lowercase X handle. */
export function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null
  const handle = raw.trim()
    .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
    .toLowerCase()
  return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : null
}

export type Guest = { luma_user_id: string; handle: string; name: string; avatar_url: string | null; is_host: boolean }

/** Hosts and featured guests of an entry that have an X handle, once each. */
export function guestsOf(entry: LumaEntry): Guest[] {
  const seen = new Map<string, Guest>()
  const add = (person: LumaPerson, isHost: boolean) => {
    const handle = normalizeHandle(person.twitter_handle)
    if (!handle || !person.api_id) return
    const known = seen.get(person.api_id)
    if (known) {
      known.is_host ||= isHost
      return
    }
    seen.set(person.api_id, {
      luma_user_id: person.api_id,
      handle,
      name: (person.name ?? '').trim().slice(0, 80),
      avatar_url: person.avatar_url ?? null,
      is_host: isHost,
    })
  }
  for (const host of entry.hosts ?? []) add(host, true)
  for (const guest of entry.featured_guests ?? []) add(guest, false)
  return [...seen.values()]
}
