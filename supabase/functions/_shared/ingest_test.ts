import { assertEquals } from 'jsr:@std/assert@1'
import { cityFromText, normalizeCity } from './cities.ts'
import { eventIdBase, fromLuma, madridDate, meetupGroup, shortName } from './ingest.ts'

Deno.test('builds readable event ids', () => {
  assertEquals(eventIdBase('Noche de IA 2026 · Madrid', '2026-03-05T18:30:00Z'), 'noche-de-ia-madrid-26')
  assertEquals(eventIdBase('¡!', '2026-12-31T23:30:00Z'), 'evento-27')
})

Deno.test('dates are read in Madrid', () => {
  assertEquals(madridDate(new Date('2026-12-31T23:30:00Z')), '2027-01-01')
})

Deno.test('short names fit the badge', () => {
  assertEquals(shortName('AI Tinkerers Madrid · Noviembre edition'), 'AI Tinkerers Madrid')
  assertEquals(shortName('Corto'), 'Corto')
})

Deno.test('reads Meetup group links', () => {
  assertEquals(meetupGroup('https://www.meetup.com/es-ES/madrid-ai/events/'), 'madrid-ai')
  assertEquals(meetupGroup('meetup.com/madrid-ai'), 'madrid-ai')
  assertEquals(meetupGroup('https://luma.com/x'), null)
})

Deno.test('normalizes cities', () => {
  assertEquals(normalizeCity('Barcelona, Catalunya'), 'Barcelona')
  assertEquals(normalizeCity('Donostia'), 'San Sebastián')
  assertEquals(normalizeCity('Lisboa'), 'Lisboa')
  assertEquals(cityFromText('Campus, Calle de Moreno Nieto 2, 28005 Madrid, Spain'), 'Madrid')
  assertEquals(cityFromText('Online event'), null)
})

Deno.test('maps Luma entries', () => {
  const payload = fromLuma({
    event: {
      api_id: 'evt-1', name: 'E', start_at: '2026-01-01T18:00:00Z', url: 'abc',
      geo_address_info: { city: 'Madrid', country_code: 'es' },
    },
    guest_count: 42,
  })
  assertEquals([payload.url, payload.city, payload.country, payload.guest_count], ['https://luma.com/abc', 'Madrid', 'ES', 42])
})

Deno.test('an online Luma event sends no city key', () => {
  const base = { api_id: 'evt-2', name: 'E', start_at: '2026-01-01T18:00:00Z', url: 'abc' }
  const online = fromLuma({ event: { ...base, geo_address_info: {} } })
  const town = fromLuma({ event: { ...base, geo_address_info: { city: 'Villarriba', country_code: 'es' } } })
  assertEquals('city' in JSON.parse(JSON.stringify(online)), false)
  assertEquals(town.city, 'Villarriba')
})
