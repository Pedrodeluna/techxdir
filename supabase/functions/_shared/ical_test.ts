import { assertEquals } from 'jsr:@std/assert@1'
import { icalDate, parseIcal } from './ical.ts'

const FEED = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:event_123@meetup.com',
  'SUMMARY:Charla\\, IA y bebidas',
  'DTSTART;TZID=Europe/Madrid:20261105T183000',
  'DTEND;TZID=Europe/Madrid:20261105T203000',
  'LOCATION:Campus\\, Calle de Moreno Nieto 2\\, 28005 Madrid\\, Spain',
  'URL:https://www.meetup.com/madrid-ai/events/123/',
  'DESCRIPTION:Una línea muy larga que se',
  '  parte en dos',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event_124@meetup.com',
  'SUMMARY:Cancelado',
  'DTSTART:20261201T170000Z',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:Sin UID',
  'DTSTART:20261201T170000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

Deno.test('parses events, unescapes text and skips incomplete ones', () => {
  const events = parseIcal(FEED)
  assertEquals(events.length, 2)
  assertEquals(events[0].summary, 'Charla, IA y bebidas')
  assertEquals(events[0].location, 'Campus, Calle de Moreno Nieto 2, 28005 Madrid, Spain')
  assertEquals(events[0].start.toISOString(), '2026-11-05T17:30:00.000Z')
  assertEquals(events[0].canceled, false)
  assertEquals(events[1].canceled, true)
})

Deno.test('reads times in their zone across daylight saving', () => {
  assertEquals(icalDate('20260715T190000', 'Europe/Madrid')?.toISOString(), '2026-07-15T17:00:00.000Z')
  assertEquals(icalDate('20260115T190000', 'Europe/Madrid')?.toISOString(), '2026-01-15T18:00:00.000Z')
  assertEquals(icalDate('20260115T190000Z')?.toISOString(), '2026-01-15T19:00:00.000Z')
  assertEquals(icalDate('nope'), null)
})
