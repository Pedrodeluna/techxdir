import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`
const sample = moduleUrl(await readFile(new URL('../web/src/data/sample.ts', import.meta.url), 'utf8'))
const source = (await readFile(new URL('../web/src/features/badge/model.ts', import.meta.url), 'utf8')).replace("'../../data/sample'", JSON.stringify(sample))
const { myEventsSplit, myOrgs, shareText, isPast } = await import(moduleUrl(source))
const { cityPoint } = await import(moduleUrl(await readFile(new URL('../web/src/features/events/locations.ts', import.meta.url), 'utf8')))
const event = { id: 'real-event', org: 'real-org', name: 'Real event', date: '2099-10-02', end: null, short: 'Real', city: 'Madrid', kind: 'Comunidad', color: '#111113', url: null }
const org = { id: 'real-org', name: 'Real organizer', logo: { mark: 'R', shape: 'circle' } }
const catalog = { events: [event], orgs: [org] }
assert.deepEqual(myEventsSplit(['real-event', 'deleted-event', 'hackspain-26'], catalog), { past: [], upcoming: [event] })
assert.deepEqual(myOrgs(['real-event', 'deleted-event'], catalog), [org])
assert.deepEqual(myEventsSplit(['hackspain-26'], { events: [], orgs: [] }), { past: [], upcoming: [] })
assert.ok(myEventsSplit(['hackspain-26']).past.length + myEventsSplit(['hackspain-26']).upcoming.length)
assert.match(shareText({ me: {}, myEvents: ['real-event'], live: true, catalog }), /Próximo: Real event/)
assert.equal(isPast({ ...event, date: '2000-01-01', end: '2099-01-01' }), false, 'Ongoing multi-day event is not past')
assert.equal(cityPoint('Online'), null)
assert.equal(cityPoint('Unknown city'), null)
assert.deepEqual(cityPoint('Cáceres'), cityPoint(' caceres '))
for (const city of ['Madrid', 'Barcelona', 'Alicante', 'Cáceres', 'Tenerife']) {
  const point = cityPoint(city)
  assert.ok(point && point.x > 0 && point.x < 760 && point.y > 50 && point.y < 570)
}
console.log('Event catalog checks passed: real/sample isolation, removed IDs, sharing, ongoing events, map locations.')
