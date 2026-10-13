// Minimal iCalendar (RFC 5545) reader for Meetup group feeds.

export type IcalEvent = {
  uid: string
  summary: string
  url: string | null
  location: string | null
  start: Date
  end: Date | null
  canceled: boolean
}

type Prop = { value: string; params: Record<string, string> }

/** Parses the VEVENT blocks of a feed. Events without UID, SUMMARY or DTSTART are skipped. */
export function parseIcal(text: string): IcalEvent[] {
  // Lines that start with a space or a tab continue the previous one.
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const events: IcalEvent[] = []
  let current: Map<string, Prop> | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = new Map()
      continue
    }
    if (line === 'END:VEVENT') {
      if (current) {
        const event = toEvent(current)
        if (event) events.push(event)
      }
      current = null
      continue
    }
    if (!current) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const [name, ...rawParams] = line.slice(0, colon).split(';')
    const params: Record<string, string> = {}
    for (const p of rawParams) {
      const eq = p.indexOf('=')
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
    }
    current.set(name.toUpperCase(), { value: line.slice(colon + 1), params })
  }
  return events
}

function toEvent(props: Map<string, Prop>): IcalEvent | null {
  const uid = props.get('UID')?.value
  const summary = props.get('SUMMARY')?.value
  const dtstart = props.get('DTSTART')
  if (!uid || !summary || !dtstart) return null
  const start = icalDate(dtstart.value, dtstart.params.TZID)
  if (!start) return null
  const dtend = props.get('DTEND')
  return {
    uid,
    summary: unescape(summary),
    url: props.get('URL')?.value ?? null,
    location: props.has('LOCATION') ? unescape(props.get('LOCATION')!.value) : null,
    start,
    end: dtend ? icalDate(dtend.value, dtend.params.TZID) : null,
    canceled: props.get('STATUS')?.value.toUpperCase() === 'CANCELLED',
  }
}

const unescape = (s: string) =>
  s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim()

/** 20261105T183000Z, 20261105T183000 (+ TZID) or 20261105 (a whole day, read as midnight in the zone). */
export function icalDate(value: string, tzid = 'Europe/Madrid'): Date | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return null
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const
  if (z) return new Date(Date.UTC(...parts))
  return zonedToUtc(parts, tzid)
}

/** The UTC instant of a wall-clock time in an IANA zone. */
export function zonedToUtc(parts: readonly [number, number, number, number, number, number], timeZone: string): Date {
  const guess = Date.UTC(...parts)
  const offset = (at: number) => {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(at))
    const get = (type: string) => Number(f.find(p => p.type === type)!.value)
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - at
  }
  // Two passes settle the offset around daylight saving changes.
  let at = guess - offset(guess)
  at = guess - offset(at)
  return new Date(at)
}
