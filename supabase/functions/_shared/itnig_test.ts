import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { itnigSourceUrl, parseItnigCalendar } from './itnig.ts'
import { emptyStats, fromIcal, type Source, syncSource } from './ingest.ts'

const entry = (id = 'ev_1', city = 'Barcelona') =>
  `BEGIN:VEVENT
UID:${id}@itnig.net
DTSTART:20991028T170000Z
DTEND:20991028T200000Z
SUMMARY:Building AI\\, together
URL:https://itnig.net/events/${id}/
LOCATION:Itnig Café\\, ${city}
STATUS:CONFIRMED
END:VEVENT`
const calendar = (events = entry()) => `BEGIN:VCALENDAR\nVERSION:2.0\n${events}\nEND:VCALENDAR\n`

Deno.test('Itnig accepts only its agenda and canonicalizes the source URL', () => {
  for (const url of ['https://itnig.net/events/', 'https://www.itnig.net/events?locale=en', 'itnig.net/events']) {
    assertEquals(itnigSourceUrl(url), 'https://itnig.net/events/')
  }
  for (
    const url of [
      'https://evil.itnig.net/events/',
      'https://itnig.net.evil.com/events/',
      'https://user@itnig.net/events/',
      'https://itnig.net:444/events/',
      'https://itnig.net/events/ev_1/',
      'file://itnig.net/events/',
      'https://luma.com/test',
      'https://meetup.com/test',
    ]
  ) {
    assertEquals(itnigSourceUrl(url), null)
  }
})

Deno.test('Itnig reads full UIDs, UTC dates, folded text, Madrid/Barcelona and cancellations', () => {
  const events = parseItnigCalendar(
    calendar(entry() + '\n' + entry('ev_2', 'Madrid').replace('CONFIRMED', 'CANCELLED')),
  )
  assertEquals(events.length, 2)
  assertEquals(events[0].uid, 'ev_1@itnig.net')
  assertEquals(events[0].summary, 'Building AI, together')
  assertEquals(events[0].start.toISOString(), '2099-10-28T17:00:00.000Z')
  assertEquals(events[1].canceled, true)
  const mapped = events.map((event) => fromIcal(event, 'itnig'))
  assertEquals(mapped.map((e) => [e.external_kind, e.city, e.country, e.guest_count]), [[
    'itnig',
    'Barcelona',
    'ES',
    null,
  ], ['itnig', 'Madrid', 'ES', null]])
  assertEquals(fromIcal(events[0]).external_kind, 'meetup')
  assertEquals(
    parseItnigCalendar(calendar(entry().replace('together', 'to\n gether')))[0].summary,
    'Building AI, together',
  )
  assertEquals(parseItnigCalendar(calendar('')), [])
})

Deno.test('Itnig rejects incomplete, malformed and ambiguous listings before any writes', () => {
  for (
    const text of [
      '<html>Unavailable</html>',
      calendar().replace('VERSION:2.0', ''),
      calendar().replace('END:VCALENDAR', ''),
      calendar().replace('END:VEVENT', ''),
      calendar().replace('UID:ev_1@itnig.net', ''),
      calendar().replace('20991028T170000Z', '20990231T170000Z'),
      calendar().replace('20991028T200000Z', 'invalid'),
      calendar().replace('20991028T200000Z', '20991028T160000Z'),
      calendar().replace('https://itnig.net/events/ev_1/', 'https://evil.com/events/ev_1/'),
      calendar(entry() + '\n' + entry()),
      calendar().replace('END:VEVENT', 'RRULE:FREQ=DAILY\nEND:VEVENT'),
    ]
  ) {
    assertThrows(() => parseItnigCalendar(text), Error, 'Itnig')
  }
})

Deno.test('source sync uses the fixed Itnig feed, filters past events and only cancels after a valid read', async () => {
  const fetchOriginal = globalThis.fetch
  const source: Source = {
    id: 'source',
    org_id: 'itnig',
    kind: 'itnig_ical',
    url: 'https://itnig.net/events/',
    external_id: 'itnig',
    country_filter: null,
  }
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const updates: Record<string, unknown>[] = []
  const db = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return Promise.resolve({ data: name === 'ingest_event' ? { action: 'created' } : 0, error: null })
    },
    from: () => ({
      update: (value: Record<string, unknown>) => {
        updates.push(value)
        return { eq: () => Promise.resolve({ error: null }) }
      },
    }),
  } as unknown as Parameters<typeof syncSource>[0]
  let response = calendar(entry() + '\n' + entry('past').replaceAll('2099', '2000'))
  globalThis.fetch = (input, init) => {
    assertEquals(input, 'https://itnig.net/api/events/calendar/?locale=es')
    assertEquals(init?.redirect, 'error')
    return Promise.resolve(new Response(response))
  }
  try {
    const stats = emptyStats()
    await syncSource(db, source, stats)
    assertEquals(stats.errors, [])
    assertEquals(stats.created, 1)
    assertEquals((calls[0].args.payload as Record<string, unknown>).external_kind, 'itnig')
    assertEquals(calls.map((c) => c.name), ['ingest_event', 'cancel_missing_events'])
    assertEquals(calls[1].args.seen, ['ev_1@itnig.net'])
    calls.length = 0
    updates.length = 0
    response = '<html>Temporary failure</html>'
    const failed = emptyStats()
    await syncSource(db, source, failed)
    assertEquals(failed.errors.length, 1)
    assertEquals(calls, [])
    assertEquals(Object.keys(updates[0]), ['last_error'])
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

Deno.test('Meetup source sync preserves its provider identity after adding Itnig', async () => {
  const original = globalThis.fetch
  const payloads: Record<string, unknown>[] = []
  globalThis.fetch = (input) => {
    assertEquals(input, 'https://www.meetup.com/old-group/events/ical/')
    return Promise.resolve(new Response(calendar(entry('one') + '\n' + entry('two'))))
  }
  const db = {
    rpc: (name: string, args: { payload?: Record<string, unknown> }) => {
      if (args.payload) payloads.push(args.payload)
      return Promise.resolve({ data: name === 'ingest_event' ? { action: 'created' } : 0, error: null })
    },
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
  } as unknown as Parameters<typeof syncSource>[0]
  try {
    const stats = emptyStats()
    await syncSource(db, {
      id: 'source',
      org_id: 'old',
      kind: 'meetup_ical',
      url: 'https://www.meetup.com/old-group/',
      external_id: 'old-group',
      country_filter: null,
    }, stats)
    assertEquals(stats.errors, [])
    assertEquals(payloads.map((p) => p.external_kind), ['meetup', 'meetup'])
  } finally {
    globalThis.fetch = original
  }
})
