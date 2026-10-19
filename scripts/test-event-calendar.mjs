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
function load(path) {
  if (path.endsWith('.css')) return {}
  if (modules.has(path)) return modules.get(path)
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const module = { exports: {} }
  modules.set(path, module.exports)
  const localRequire = name => {
    if (!name.startsWith('.')) return require(name)
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
