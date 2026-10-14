// A stand-in for api.lu.ma with fake data, to try the import locally without
// calling Luma. Pairs with scripts/seed-local-ingest.sql.
//
//   node scripts/luma-mock.mjs            # listens on 127.0.0.1:55399
//   LUMA_API_BASE=http://host.docker.internal:55399 in supabase/functions/.env
//
// URLs it knows: luma.com/demo-ia-madrid and luma.com/demo-suggested
// (calendars), luma.com/demo-hackathon-agentes (a single event).
import { createServer } from 'node:http'

const port = Number(process.env.PORT ?? 55399)
const day = 24 * 60 * 60 * 1000
const at = (days, hour) => {
  const d = new Date(Date.now() + days * day)
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}
const person = (id, name, handle) => ({ api_id: `usr-${id}`, name, avatar_url: null, twitter_handle: handle })
const place = (city, country_code = 'ES') => ({ city, country_code })

const calendars = {
  'demo-ia-madrid': { api_id: 'cal-demo', name: 'Demo IA Madrid', slug: 'demo-ia-madrid' },
  'demo-suggested': { api_id: 'cal-demo-suggested', name: 'Demo Startups BCN', slug: 'demo-suggested' },
}

const entry = (id, slug, name, start, geo, guests, hosts, featured) => ({
  api_id: `entry-${id}`,
  event: { api_id: id, name, start_at: start, end_at: null, timezone: 'Europe/Madrid', url: slug, visibility: 'public', geo_address_info: geo },
  guest_count: guests,
  hosts,
  featured_guests: featured,
  status: 'approved',
})

const items = {
  'cal-demo': [
    entry('evt-demo-1', 'demo-noche-ia', 'Noche de IA · Madrid', at(10, 17), place('Madrid'), 64,
      [person('demo-1', 'Lucía Demo', 'demo_lucia')],
      [person('demo-2', 'Marcos Demo', 'demo_marcos'), person('demo-3', 'Irene Demo', 'https://x.com/demo_irene'),
        person('demo-4', 'Sara Demo', '@demo_sara'), person('demo-9', 'Sin X Demo', null)]),
    entry('evt-demo-2', 'demo-ia-produccion', 'IA generativa en producción', at(24, 17), place('Madrid'), 48,
      [person('demo-5', 'Pablo Demo', 'demo_pablo')],
      [person('demo-1', 'Lucía Demo', 'demo_lucia'), person('demo-2', 'Marcos Demo', 'demo_marcos')]),
  ],
  'cal-demo-suggested': [
    entry('evt-demo-bcn-1', 'demo-startups-bcn', 'Startups & IA Barcelona', at(14, 17), place('Barcelona'), 120,
      [person('demo-6', 'Nuria Demo', 'demo_nuria')], [person('demo-3', 'Irene Demo', 'demo_irene')]),
    entry('evt-demo-lis-1', 'demo-startups-lisboa', 'Startups & IA Lisboa', at(21, 17), place('Lisboa', 'PT'), 80, [], []),
  ],
}

const single = entry('evt-demo-hack', 'demo-hackathon-agentes', 'Hackathon de agentes', at(31, 8), place('Valencia'), 150,
  [person('demo-7', 'Jorge Demo', 'demo_jorge')], [person('demo-1', 'Lucía Demo', 'demo_lucia')])

// Loose events that are already imported (their slug is all the refresh knows).
const loose = [entry('evt-demo-loose', 'demo-taller', 'Taller de agentes con IA', at(17, 16), place('Madrid'), 40, [], [])]

const events = Object.fromEntries([...Object.values(items).flat(), single, ...loose].map(e => [e.event.url, e]))

function route(path, q) {
  if (path === '/url') {
    const slug = q.get('url')
    if (calendars[slug]) return { kind: 'calendar', data: { calendar: calendars[slug] } }
    if (events[slug]) return { kind: 'event', data: events[slug] }
    return null
  }
  if (path === '/calendar/get-items') {
    const list = items[q.get('calendar_api_id')]
    return list ? { entries: list, has_more: false, next_cursor: null } : null
  }
  if (path === '/discover/get-paginated-events') return { entries: [], has_more: false, next_cursor: null }
  return null
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const body = route(url.pathname, url.searchParams)
  console.log(req.method, url.pathname + url.search, body ? 200 : 404)
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body ?? { message: 'not found' }))
}).listen(port, '0.0.0.0', () => console.log(`Luma mock on http://127.0.0.1:${port}`))
