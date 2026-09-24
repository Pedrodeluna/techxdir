import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Avatar } from '../bits'
import { at, focusQuiet, replay } from '../dom'
import { EV, PEOPLE, peopleOf, byDateAsc, byDateDesc, contacts, fmtDate, isPast, others, plural, type BadgeState } from '../model'

export type PeopleTab = 'match' | 'others' // 'match' = con las que coincidiste · 'others' = el resto
type Mode = 'initial' | 'quiet' | 'tab' | 'enter'

interface Props {
  state: BadgeState
  bodyRef: RefObject<HTMLDivElement | null>
  tab: PeopleTab
  setTab: (tab: PeopleTab) => void
}

export function PeoplePanel({ state, bodyRef, tab, setTab }: Props) {
  const [query, setQuery] = useState('')
  const [personId, setPersonId] = useState<string | null>(null)
  const [render, setRender] = useState<{ key: number; mode: Mode; from?: string }>({ key: 0, mode: 'initial' })
  const first = useRef(true)

  useLayoutEffect(() => {
    if (first.current) { first.current = false; return }
    const body = bodyRef.current
    if (!body) return
    if (render.mode === 'enter') {
      body.style.setProperty('--base', '0ms')
      body.scrollTop = 0
      replay(body, 'slide-in')
      focusQuiet(body.querySelector('[data-people-back]'))
    } else if (render.mode === 'quiet' && render.from) {
      replay(body, 'slide-back')
      focusQuiet(body.querySelector(`[data-person="${render.from}"]`))
    }
  }, [render, bodyRef])

  const showPerson = (id: string) => {
    setPersonId(id)
    setRender(r => ({ key: r.key + 1, mode: 'enter' }))
  }

  const backToPeople = () => {
    const from = personId ?? undefined
    setPersonId(null)
    setRender(r => ({ key: r.key + 1, mode: 'quiet', from }))
  }

  const changeTab = (next: PeopleTab) => {
    if (next === tab) return
    setTab(next)
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    setRender(r => ({ key: r.key + 1, mode: 'tab' }))
  }

  if (personId) {
    return <PersonView key={render.key} id={personId} state={state} onBack={backToPeople} />
  }

  const all = peopleOf(state)
  const matchCount = contacts(state.myEvents, all).length
  const isMatch = tab === 'match'
  const people = isMatch ? contacts(state.myEvents, all) : others(state.myEvents, all)
  const q = query.trim().toLowerCase().replace(/^@/, '')
  const shown = q
    ? people.filter(p => [p.name, p.handle, p.role, ...p.events.map(id => EV.get(id)?.name || '')].some(s => s.toLowerCase().includes(q)))
    : people
  const empty = people.length
    ? 'Nadie coincide con esa búsqueda.'
    : (isMatch ? 'Marca eventos para descubrir con quién coincidiste.' : 'Has coincidido con todo el mundo.')
  const { mode } = render

  return (
    <>
      <div className="seg" role="tablist" aria-label="Filtrar personas">
        <button className="seg-btn" type="button" role="tab" aria-selected={isMatch} onClick={() => changeTab('match')}>Coincidencias<b>{matchCount}</b></button>
        <span className="seg-sep" aria-hidden="true" />
        <button className="seg-btn" type="button" role="tab" aria-selected={!isMatch} onClick={() => changeTab('others')}>Otros<b>{all.length - matchCount}</b></button>
      </div>
      <input
        className="search"
        type="search"
        placeholder="Buscar por nombre, @usuario o evento"
        aria-label="Buscar personas"
        autoComplete="off"
        value={query}
        onChange={ev => {
          setQuery(ev.target.value)
          if (mode !== 'quiet') setRender(r => ({ ...r, mode: 'quiet', from: undefined }))
        }}
      />
      <ul
        key={render.key}
        className={`stagger${mode === 'quiet' ? ' quiet' : ''}`}
        role="tabpanel"
        style={mode === 'tab' ? ({ '--base': '0ms' } as CSSProperties) : undefined}
      >
        {shown.length ? shown.map((p, i) => (
          <li className="person" style={at(i)} key={p.id}>
            <button className="person-row" type="button" data-person={p.id} aria-label={`Ver perfil de ${p.name}`} onClick={() => showPerson(p.id)}>
              <Avatar name={p.name} />
              <span className="p-info">
                <strong>{p.name}</strong>
                <span><span className="p-handle">@{p.handle}</span> · {p.role}</span>
              </span>
              <span className="p-count">{isMatch ? `${p.shared.length} en común` : plural(p.events.length, 'evento', 'eventos')}</span>
              <span className="p-chev" aria-hidden="true">→</span>
            </button>
          </li>
        )) : <li className="empty">{empty}</li>}
      </ul>
    </>
  )
}

/* Perfil de una persona: sus datos y los eventos a los que ha ido o irá.
   También se abre desde la lista de asistentes de un evento. */

interface PersonViewProps {
  id: string
  state: BadgeState
  backLabel?: string
  onBack: () => void
}

export function PersonView({ id, state, backLabel = '← Todas las personas', onBack }: PersonViewProps) {
  const p = PEOPLE.find(x => x.id === id)!
  const mine = new Set(state.myEvents)
  const evs = p.events.map(eid => EV.get(eid)).filter(e => e !== undefined)
  const upcoming = evs.filter(e => !isPast(e)).sort(byDateAsc)
  const past = evs.filter(isPast).sort(byDateDesc)
  const shared = evs.filter(e => mine.has(e.id)).length

  let i = 3
  const groups = ([['Próximos', upcoming], ['Ha ido a', past]] as const).filter(([, list]) => list.length).map(([title, list]) => (
    <Fragment key={title}>
      <h3 className="group-title" style={at(i++)}>{title}</h3>
      {list.map(e => {
        const d = fmtDate(e)
        return (
          <article className="ev" style={at(i++)} key={e.id}>
            <div className="ev-date">{d.day} {d.mon}<small>{d.year}</small></div>
            <div className="ev-info">
              <strong>{e.name}</strong>
              <span>{e.city} · {e.kind}</span>
            </div>
            {mine.has(e.id) ? <span className="tag">En común</span> : <span />}
          </article>
        )
      })}
    </Fragment>
  ))

  return (
    <div className="stagger person-view" data-id={p.id}>
      <button className="link back-link" type="button" data-people-back data-view-back style={at(0)} onClick={onBack}>{backLabel}</button>
      <div className="pv-head" style={at(1)}>
        <Avatar name={p.name} />
        <div>
          <strong>{p.name}</strong>
          <span className="p-handle">@{p.handle}</span>
          <span>{p.role}</span>
        </div>
      </div>
      {p.bio && <p className="pv-bio" style={at(2)}>{p.bio}</p>}
      <div className="pv-stats" style={at(2)}>
        <div><strong>{evs.length}</strong><span>{evs.length === 1 ? 'evento' : 'eventos'}</span></div>
        <div><strong>{shared}</strong><span>en común contigo</span></div>
      </div>
      {groups}
    </div>
  )
}
