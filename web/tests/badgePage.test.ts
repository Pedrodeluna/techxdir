import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { GET, badgePage, type Badge } from '../api/badge.ts'

const API = 'https://ref.supabase.co'
const BADGE: Badge = { id: '00000000-0000-4000-8000-000000000001', name: 'Pedro de Luna', handle: 'pedrodelunah', role: 'Fundador', company: 'nódicus' }
const IMAGE = `${API}/storage/v1/object/public/badges/${BADGE.id}.png`

const realFetch = globalThis.fetch
let calls: { url: string; init?: RequestInit }[] = []

function mockFetch(profiles: Badge[], imageStatus = 200) {
  calls = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.startsWith(`${API}/rest/v1/profiles`)) return Response.json(profiles)
    if (url.startsWith(`${API}/storage/`)) return new Response(null, { status: imageStatus })
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch
}

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = `${API}/`
  process.env.VITE_SUPABASE_ANON_KEY = 'anon'
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const get = (query: string) => GET(new Request(`https://techxdir.es/api/badge?${query}`))

test('serves the X card with the uploaded badge image for that version', async () => {
  mockFetch([BADGE])
  const res = await get('handle=PedroDeLunah&v=0a1b2c3d4e5f')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type')!, /^text\/html/)
  const html = await res.text()
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/)
  assert.ok(html.includes(`<meta name="twitter:image" content="${IMAGE}?v=0a1b2c3d4e5f" />`))
  assert.ok(html.includes(`<meta property="og:image" content="${IMAGE}?v=0a1b2c3d4e5f" />`))
  assert.ok(html.includes('<meta property="og:url" content="https://techxdir.es/acreditacion/pedrodelunah?v=0a1b2c3d4e5f" />'))
  assert.ok(html.includes('<title>Pedro de Luna · techxdir</title>'))
  // búsqueda sin distinguir mayúsculas y comprobación de que la imagen existe
  assert.equal(calls[0].url, `${API}/rest/v1/profiles?select=id,name,handle,role,company&handle=ilike.PedroDeLunah&limit=1`)
  assert.deepEqual(calls[0].init?.headers, { apikey: 'anon', Accept: 'application/json' })
  assert.equal(calls[1].init?.method, 'HEAD')
})

test('reads the handle from the original path when the rewrite does not pass it', async () => {
  mockFetch([BADGE])
  const res = await GET(new Request('https://techxdir.es/acreditacion/pedrodelunah?v=abc'))
  assert.equal(res.status, 200)
  assert.ok(calls[0].url.includes('handle=ilike.pedrodelunah&'))
})

test('escapes the underscore wildcard when looking up the handle', async () => {
  mockFetch([{ ...BADGE, handle: 'a_b' }])
  await get('handle=a_b')
  assert.ok(calls[0].url.includes('handle=ilike.a%5C_b&'))
})

test('falls back to a summary card when the person has not shared an image yet', async () => {
  mockFetch([BADGE], 400)
  const html = await (await get('handle=pedrodelunah')).text()
  assert.match(html, /<meta name="twitter:card" content="summary" \/>/)
  assert.doesNotMatch(html, /og:image|twitter:image|<img/)
})

test('ignores a malformed version', async () => {
  mockFetch([BADGE])
  const html = await (await get('handle=pedrodelunah&v=%22%3E%3Cscript%3E')).text()
  assert.ok(html.includes(`<meta name="twitter:image" content="${IMAGE}" />`))
  assert.doesNotMatch(html, /<script/)
})

test('redirects home for invalid or unknown handles and without configuration', async () => {
  mockFetch([])
  for (const query of ['handle=' + encodeURIComponent('../etc'), 'handle=waytoolonghandle_x', 'handle=nobody']) {
    const res = await get(query)
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), 'https://techxdir.es/')
  }
  delete process.env.VITE_SUPABASE_URL
  assert.equal((await get('handle=pedrodelunah')).status, 302)
})

test('escapes profile text in the page', () => {
  const html = badgePage({
    badge: { ...BADGE, name: '<img src=x onerror=alert(1)>', role: 'A & "B"', company: '' },
    pageUrl: 'https://techxdir.es/acreditacion/pedrodelunah',
    homeUrl: 'https://techxdir.es/',
    imageUrl: null,
  })
  assert.doesNotMatch(html, /<img src=x/)
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; · techxdir'))
  assert.ok(html.includes('<p>A &amp; &quot;B&quot;</p>'))
})

test('uses the handle when the name is empty', () => {
  const html = badgePage({ badge: { ...BADGE, name: '  ' }, pageUrl: 'https://techxdir.es/x', homeUrl: 'https://techxdir.es/', imageUrl: null })
  assert.ok(html.includes('<title>@pedrodelunah · techxdir</title>'))
})
