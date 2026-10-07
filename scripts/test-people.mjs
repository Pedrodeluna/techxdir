import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Exercise the real TS/TSX modules without a browser or a production connection.
const server = await createServer({
  root: new URL('../web', import.meta.url).pathname,
  configFile: false, envDir: false, plugins: [react()],
  server: { middlewareMode: true, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
})
try {
  const { loadPeople, peopleFromRows } = await server.ssrLoadModule('/src/features/badge/people.ts')
  const { contacts, others, peopleOf, shareText, DEFAULT_ME, PEOPLE } = await server.ssrLoadModule('/src/features/badge/model.ts')
  const { PeoplePanel, PersonView } = await server.ssrLoadModule('/src/features/badge/panels/PeoplePanel.tsx')
  const event = (id, date) => ({ id, date, name: `Evento ${id}`, org: 'org', short: id, city: 'Madrid', end: null, url: null, kind: 'Comunidad', color: '#111' })
  const catalog = { events: [event('real-a', '2020-01-01'), event('real-b', '2099-01-01')], orgs: [] }
  const profile = (id, handle = id) => ({ id, name: `Persona ${id}`, handle, role: 'Developer', bio: `Bio ${id}` })
  const profiles = [profile('me'), profile('ana'), profile('bea'), profile('new', null)]
  const attendances = [
    { profile_id: 'me', event_id: 'real-a' },
    { profile_id: 'ana', event_id: 'real-a' },
    { profile_id: 'ana', event_id: 'real-b' },
    { profile_id: 'ana', event_id: 'deleted' },
    { profile_id: 'bea', event_id: 'real-b' },
  ]
  const people = peopleFromRows(profiles, attendances, 'me')
  const state = { me: DEFAULT_ME, myEvents: ['real-a', 'real-b', 'deleted'], live: true, catalog, people }
  assert.deepEqual(people.map(p => p.id), ['ana', 'bea', 'new'])
  assert.deepEqual(people[2].events, [])
  assert.equal(people[2].handle, '')
  assert.deepEqual(peopleOf({ ...state, people: undefined }), [])
  assert.equal(peopleOf({ ...state, live: false }), PEOPLE)
  assert.deepEqual(contacts(state.myEvents, people, catalog).map(p => [p.id, p.shared.map(e => e.id)]), [['ana', ['real-b', 'real-a']], ['bea', ['real-b']]])
  assert.deepEqual(others(state.myEvents, people, catalog).map(p => p.id), ['new'])
  assert.equal(contacts([], people, catalog).length, 0)
  assert.equal(contacts(state.myEvents, people, { events: [], orgs: [] }).length, 0)
  assert.deepEqual(peopleOf(state).filter(p => p.events.includes('real-a')).map(p => p.id), ['ana'])
  assert.match(shareText(state), /2 personas/)

  const panel = extra => renderToStaticMarkup(createElement(PeoplePanel, { state, bodyRef: { current: null }, tab: 'match', setTab() {}, ...extra }))
  assert.match(panel(), /Persona ana/)
  assert.match(panel(), /2 en común/)
  assert.doesNotMatch(panel(), /Persona me/)
  assert.match(panel({ tab: 'others' }), /Persona new/)
  assert.match(panel({ state: { ...state, peopleLoading: true, people: [] } }), /Cargando personas/)
  assert.match(panel({ state: { ...state, peopleError: true, people: [] } }), /Reintentar/)
  const person = id => renderToStaticMarkup(createElement(PersonView, { state, id, onBack() {} }))
  assert.match(person('ana'), /Evento real-a/)
  assert.match(person('ana'), /Evento real-b/)
  assert.match(person('ana'), /Bio ana/)
  assert.doesNotMatch(person('ana'), /deleted/)
  assert.doesNotMatch(person('new'), /https:\/\/x.com\//)
  assert.match(person('removed'), /ya no está disponible/)

  // Simulate PostgREST's paged responses, with a match beyond the first page.
  const manyProfiles = Array.from({ length: 501 }, (_, i) => profile(`p${i}`))
  const manyAttendances = manyProfiles.map(p => ({ profile_id: p.id, event_id: 'real-a' }))
  const calls = []
  function client(failedTable) {
    return { from(table) {
      let start, end
      const query = {
        select() { return query },
        neq(column, value) { assert.equal(value, 'me'); assert.equal(column, table === 'profiles' ? 'id' : 'profile_id'); return query },
        order() { return query },
        range(a, b) { start = a; end = b; return query },
        abortSignal(signal) {
          assert.ok(signal instanceof AbortSignal)
          calls.push([table, start, end])
          return Promise.resolve(table === failedTable ? { data: null, error: new Error('offline') } : {
            data: (table === 'profiles' ? manyProfiles : manyAttendances).slice(start, end + 1), error: null,
          })
        },
      }
      return query
    } }
  }
  const loaded = await loadPeople(client(), 'me', new AbortController().signal)
  assert.equal(loaded.length, 501)
  assert.deepEqual(loaded[500].events, ['real-a'])
  assert.equal(calls.length, 4)
  for (const table of ['profiles', 'attendances']) {
    await assert.rejects(loadPeople(client(table), 'me', new AbortController().signal), /offline/)
  }
  console.log('People regression checks passed: real matches, attendees, profiles, empty/error/loading states, account exclusion, pagination and request failures.')
} finally {
  await server.close()
}
