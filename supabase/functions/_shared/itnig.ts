import { type IcalEvent, parseIcal } from './ical.ts'

export const ITNIG_URL = 'https://itnig.net/events/'
export const ITNIG_CALENDAR = 'https://itnig.net/api/events/calendar/?locale=es'

/** Only the agenda is accepted, never an arbitrary feed or event-detail URL. */
export function itnigSourceUrl(input: string): string | null {
  try {
    const url = new URL(input.includes('://') ? input.trim() : `https://${input.trim()}`)
    return ['https:', 'http:'].includes(url.protocol) && ['itnig.net', 'www.itnig.net'].includes(url.hostname) &&
        !url.username && !url.password && !url.port && /^\/events\/?$/.test(url.pathname)
      ? ITNIG_URL
      : null
  } catch {
    return null
  }
}

/** A partial/malformed calendar must never look like an empty successful read. */
export function parseItnigCalendar(text: string): IcalEvent[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').trim().split('\n')
  const invalid = () => {
    throw new Error('Itnig returned an invalid or incomplete calendar')
  }
  if (lines.shift() !== 'BEGIN:VCALENDAR' || lines.pop() !== 'END:VCALENDAR') invalid()
  if (lines.filter((line) => line === 'VERSION:2.0').length !== 1) invalid()
  const blocks: string[][] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT' && !current) current = [line]
    else if (line === 'END:VEVENT' && current) {
      blocks.push([...current, line])
      current = null
    } else if (/^(BEGIN|END):/.test(line)) invalid()
    else if (current) current.push(line)
  }
  if (current) invalid()
  const seen = new Set<string>()
  return blocks.map((block) => {
    const events = parseIcal(block.join('\n'))
    if (events.length !== 1) invalid()
    const event = events[0]
    const id = event.url?.match(/^https:\/\/(?:www\.)?itnig\.net\/events\/([\w-]+)\/?$/)?.[1]
    if (!id || event.uid !== `${id}@itnig.net` || seen.has(event.uid) || !event.summary.trim()) invalid()
    seen.add(event.uid)
    for (const name of ['UID', 'SUMMARY', 'URL', 'DTSTART', 'DTEND']) {
      const values = block.filter((line) => line.startsWith(`${name}:`))
      if (values.length !== (name === 'DTEND' && !event.end ? 0 : 1)) invalid()
      if (name.startsWith('DT') && values.length) {
        const date = name === 'DTSTART' ? event.start : event.end!
        const utc = date.toISOString().replace(/[-:]/g, '').replace('.000', '')
        if (values[0] !== `${name}:${utc}`) invalid()
      }
    }
    if (event.end && event.end < event.start) invalid()
    // Recurring components need occurrence identities; this feed currently uses individual events.
    if (block.some((line) => /^(RRULE|RDATE|EXDATE|RECURRENCE-ID)[:;]/.test(line))) invalid()
    return event
  })
}

export async function readItnigCalendar(): Promise<IcalEvent[]> {
  const response = await fetch(ITNIG_CALENDAR, {
    headers: { 'User-Agent': 'techxdir-sync/1.0 (+https://github.com/Pedrodeluna/techxdir)' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`Itnig calendar HTTP ${response.status}`)
  return parseItnigCalendar(await response.text())
}
