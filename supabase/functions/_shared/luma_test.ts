import { assertEquals } from 'jsr:@std/assert@1'
import { guestsOf, lumaSlug, normalizeHandle } from './luma.ts'

Deno.test('normalizes X handles from Luma', () => {
  assertEquals(normalizeHandle('@Someone_1'), 'someone_1')
  assertEquals(normalizeHandle('https://x.com/Someone?s=21'), 'someone')
  assertEquals(normalizeHandle('https://twitter.com/someone/'), 'someone')
  assertEquals(normalizeHandle('a handle with spaces'), null)
  assertEquals(normalizeHandle('waytoolonghandle_123'), null)
  assertEquals(normalizeHandle(null), null)
})

Deno.test('extracts the slug of Luma links', () => {
  assertEquals(lumaSlug('https://luma.com/aitinkerers-madrid'), 'aitinkerers-madrid')
  assertEquals(lumaSlug('https://lu.ma/abc123?tk=x'), 'abc123')
  assertEquals(lumaSlug('abc123'), 'abc123')
  assertEquals(lumaSlug('https://example.com/abc123'), null)
})

Deno.test('keeps hosts and featured guests with a handle, once each', () => {
  const event = { api_id: 'evt-1', name: 'E', start_at: '2026-01-01T00:00:00Z', url: 'e' }
  const guests = guestsOf({
    event,
    hosts: [{ api_id: 'usr-1', name: 'Host', twitter_handle: 'host_x' }],
    featured_guests: [
      { api_id: 'usr-1', name: 'Host', twitter_handle: 'host_x' },
      { api_id: 'usr-2', name: 'Guest', twitter_handle: '@Guest_Y' },
      { api_id: 'usr-3', name: 'No handle', twitter_handle: null },
    ],
  })
  assertEquals(guests.map(g => [g.luma_user_id, g.handle, g.is_host]), [
    ['usr-1', 'host_x', true],
    ['usr-2', 'guest_y', false],
  ])
})
