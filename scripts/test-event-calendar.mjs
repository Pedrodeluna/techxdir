import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../web/src/features/events/calendar.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { monthDays, shiftMonth, eventsOnDay, dateKey, weekDays, shiftDay } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
assert.deepEqual(weekDays('2027-01-01'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
assert.equal(shiftDay('2024-02-26', 7), '2024-03-04')
assert.equal(shiftDay('2026-03-30', -7), '2026-03-23')
assert.equal(weekDays('2026-10-25').length, 7)
assert.equal(monthDays('2024-02')[0], '2024-01-29')
assert.equal(monthDays('2024-02').length, 35)
assert.ok(monthDays('2024-02').includes('2024-02-29'))
assert.equal(monthDays('2026-03').length, 42)
assert.equal(shiftMonth('2026-12', 1), '2027-01')
assert.equal(shiftMonth('2026-01', -1), '2025-12')
assert.equal(dateKey(new Date(2026, 9, 19)), '2026-10-19')
const events = [
  { id: 'b', name: 'Beta', date: '2026-10-01', end: null },
  { id: 'a', name: 'Alpha', date: '2026-09-30', end: '2026-10-02' },
]
assert.deepEqual(eventsOnDay(events, '2026-10-01').map(e => e.id), ['a', 'b'])
assert.equal(eventsOnDay(events, '2026-10-02').length, 1)
assert.equal(eventsOnDay(events, '2026-10-03').length, 0)
assert.deepEqual(events.map(e => e.id), ['b', 'a'])
console.log('Calendar checks passed: Monday-first, leap years, month boundaries, inclusive spans, stable dates and ordering.')

// Render the public components with the same saved filter state a browser restores.
const { createRequire } = await import('node:module')
const { readFileSync } = await import('node:fs')
const { resolve, dirname } = await import('node:path')
const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const modules = new Map()
const overrides = new Map()
function load(path) {
  if (overrides.has(path)) return overrides.get(path)
  if (path.endsWith('.css')) return {}
  if (modules.has(path)) return modules.get(path)
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const module = { exports: {} }
  modules.set(path, module.exports)
  const localRequire = name => {
    if (!name.startsWith('.')) return overrides.get(name) ?? require(name)
    const target = resolve(dirname(path), name)
    if (name.endsWith('.css')) return {}
    try { return load(`${target}.ts`) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return load(`${target}.tsx`)
    }
  }
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports)
  return module.exports
}
const { EventMap } = load(resolve('web/src/features/events/EventMap.tsx'))
const today = dateKey(new Date())
const fixture = [
  { id: 'today', name: 'Current Madrid', date: today, end: null, city: 'Madrid', kind: 'Meetup' },
  { id: 'other', name: 'Current Barcelona', date: today, end: null, city: 'Barcelona', kind: 'Meetup' },
  { id: 'old', name: 'Historic Madrid', date: '2000-01-01', end: null, city: 'Madrid', kind: 'Meetup' },
]
const render = state => {
  globalThis.sessionStorage = { getItem: () => JSON.stringify(state) }
  return renderToStaticMarkup(React.createElement(EventMap, { events: fixture, persistenceKey: 'test', searchable: true }))
}
const calendar = render({ view: 'calendar', period: 'all', city: 'Madrid', query: 'madrid' })
assert.match(calendar, /aria-pressed="true"[^>]*>Calendario/)
assert.match(calendar, /Current Madrid/)
assert.doesNotMatch(calendar, /Current Barcelona/)
assert.match(calendar, /Historic Madrid/)
assert.match(render({ view: 'calendar', period: 'past', city: null, query: '' }), /Historic Madrid/)
assert.doesNotMatch(render({ view: 'calendar', period: 'past', city: null, query: '' }), /Current Madrid/)
assert.match(render({ view: 'list', period: 'past', query: '' }), /aria-pressed="true"[^>]*>Lista/)
assert.doesNotMatch(render({ view: 'map', period: 'all', query: '' }), /Historic Madrid/)
assert.match(render({ view: 'invalid', period: 'all', query: '' }), /aria-pressed="true"[^>]*>Mapa/)
delete globalThis.sessionStorage
console.log('Rendered explorer checks passed: calendar restoration, shared filters, list preservation and future-only map.')
const weekMarkup = calendar.slice(calendar.indexOf('class="calendar-week-strip"'), calendar.indexOf('class="calendar-month-view"'))
assert.equal((weekMarkup.match(/class="calendar-week-day"/g) ?? []).length, 7)
assert.equal((weekMarkup.match(/aria-pressed="true"/g) ?? []).length, 1)
assert.match(calendar, /aria-label="Semana anterior"/)
assert.match(calendar, /aria-label="Semana siguiente"/)
assert.match(calendar, /aria-label="Mes anterior"/)
assert.match(weekMarkup, /calendar-week-indicator has-events/)
const agendaMarkup = calendar.slice(calendar.indexOf('class="calendar-agenda"')).split('</section>')[0]
assert.match(agendaMarkup, /Current Madrid/)
assert.doesNotMatch(agendaMarkup, /Historic Madrid/)
console.log('Weekly agenda checks passed: seven days, selected day, event indicators, full daily agenda and retained month controls.')
assert.match(calendar, /aria-label="Periodo del calendario"/)
assert.match(calendar, /aria-pressed="false"[^>]*>Semana<\/button>/)
assert.match(calendar, /aria-pressed="true"[^>]*>Mes<\/button>/)

globalThis.window = { matchMedia: () => ({ matches: true }) }
const mobileCalendar = render({ view: 'calendar', period: 'all', city: 'Madrid', query: '' })
assert.match(mobileCalendar, /data-view="week"/)
assert.match(mobileCalendar, /aria-pressed="true"[^>]*>Semana<\/button>/)
assert.match(calendar, /data-view="month"/)
delete globalThis.window
delete globalThis.sessionStorage
console.log('Calendar view switch checks passed: accessible week/month selector and responsive defaults.')

// Organizer lookup must use catalog metadata, even when the event title has no brand.
const orgFixture = [
  { id: 'source-42', name: 'Itnig', logo: 'I' },
  { id: 'community-7', name: 'Comunidad Técnica', logo: 'C' },
]
const searchFixture = [
  { ...fixture[0], id: 'ai', org: 'source-42', name: 'Construyendo IA en Europa' },
  { ...fixture[1], id: 'devin', org: 'source-42', name: 'Gremio.day x Devin.ai' },
  { ...fixture[0], id: 'other-org', org: 'community-7', name: 'Java Workshop' },
  { ...fixture[2], id: 'old-org', org: 'source-42', name: 'Historic Workshop' },
]
const renderSearch = (query, extra = {}) => {
  globalThis.sessionStorage = { getItem: () => JSON.stringify({ view: 'list', period: 'next', query, ...extra }) }
  return renderToStaticMarkup(React.createElement(EventMap, { events: searchFixture, orgs: orgFixture, persistenceKey: 'test', searchable: true }))
}
const branded = renderSearch('  ITNIG ')
assert.match(branded, /Construyendo IA en Europa/)
assert.match(branded, /Gremio.day x Devin.ai/)
assert.doesNotMatch(branded, /Java Workshop|Historic Workshop/)
assert.match(renderSearch('comunidad tecnica'), /Java Workshop/)
assert.match(renderSearch('source-42'), /Construyendo IA en Europa/)
assert.doesNotMatch(renderSearch('itnig', { city: 'Madrid' }), /Gremio.day x Devin.ai/)
assert.match(renderSearch('itnig', { period: 'past' }), /Historic Workshop/)
assert.doesNotMatch(renderSearch('itnig', { period: 'past' }), /Construyendo IA en Europa/)
for (const query of ['construyendo', 'madrid', 'meetup', '']) {
  assert.match(renderSearch(query), /Construyendo IA en Europa/, `Existing public search: ${query}`)
}
assert.doesNotMatch(renderSearch('unknown organizer'), /Construyendo IA en Europa|Java Workshop/)
delete globalThis.sessionStorage
console.log('Organizer explorer checks passed: catalog names, IDs, accents, city/date filters and existing search.')

// Render the admin public component with loaded state; effects and writes remain disabled.
const adminEvents = searchFixture.map(e => ({ ...e, org_id: e.org, short: 'Brief title', starts_on: e.date, ends_on: e.end, status: 'published' }))
let adminState = []
overrides.set('react', { ...React,
  useState: () => [adminState.shift(), () => {}],
  useEffect: () => {},
  useMemo: fn => fn(),
  useCallback: fn => fn,
})
const adminPath = resolve('web/src/pages/admin')
overrides.set(resolve(adminPath, '../../lib/supabase.ts'), { supabase: null })
overrides.set(resolve(adminPath, 'context.ts'), { useAdmin: () => ({ busy: false, run: () => {} }), formatDate: day => day })
overrides.set(resolve(adminPath, 'shared.ts'), {
  SectionHead: () => null, Empty: ({ children }) => React.createElement('p', null, children), SkeletonRows: () => null,
})
const { EventsSection } = load(resolve(adminPath, 'EventsSection.tsx'))
const renderAdmin = (query, orgFilter = '', when = 'upcoming') => {
  adminState = [adminEvents, orgFixture, {}, '', query, orgFilter, when, null, false]
  return renderToStaticMarkup(React.createElement(EventsSection))
}
const adminBranded = renderAdmin('ITNIG')
assert.match(adminBranded, /Construyendo IA en Europa/)
assert.match(adminBranded, /Gremio.day x Devin.ai/)
assert.doesNotMatch(adminBranded, /Java Workshop|Historic Workshop/)
assert.match(renderAdmin('community-7'), /Java Workshop/)
assert.doesNotMatch(renderAdmin('itnig', 'community-7'), /Construyendo IA en Europa/)
assert.match(renderAdmin('itnig', '', 'past'), /Historic Workshop/)
for (const query of ['construyendo', 'brief title', 'madrid', 'ai', '']) {
  assert.match(renderAdmin(query), /Construyendo IA en Europa/, `Existing admin search: ${query}`)
}
console.log('Admin organizer checks passed: names, IDs, organization/date filters and existing search.')
