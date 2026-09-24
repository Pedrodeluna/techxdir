import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject, type RefObject } from 'react'
import type { TechEvent } from '../../../data/sample'
import { Avatar, OrgLogo } from '../bits'
import { xProfilePhoto } from '../lib/xProfilePhoto'
import { at, focusQuiet, replay } from '../dom'
import { downloadIcs } from '../lib/download'
import { PersonView } from './PeoplePanel'
import {
  EV, EVENTS, ORG, PEOPLE, peopleOf, byDateAsc, byDateDesc, contacts, contactsAt, fmtDate, fmtRange, isPast,
  myEventsSplit, orgEvents, orgOf, pillLabel, plural, whenLabel, type BadgeState,
} from '../model'

/* Navegación dentro del panel de eventos: lista → evento ⇄ organización → … → persona */

export type EventsTab = 'mine' | 'discover'
type View = { type: 'event' | 'org' | 'person'; id: string }
type Mode = 'initial' | 'quiet' | 'tab' | 'enter' | 'back' | 'refresh'

interface Props {
  state: BadgeState
  toggle: (id: string) => boolean
  bodyRef: RefObject<HTMLDivElement | null>
  tab: EventsTab
  setTab: (tab: EventsTab) => void
  escRef: MutableRefObject<(() => boolean) | null>
}

export function EventsPanel({ state, toggle, bodyRef, tab, setTab, escRef }: Props) {
  const [trail, setTrail] = useState<View[]>([]) // pila de vistas abiertas
  const [render, setRender] = useState<{ key: number; mode: Mode }>({ key: 0, mode: 'initial' })
  // la lista se pinta con una copia: un evento que quitas sale animado antes de desaparecer
  const [listMine, setListMine] = useState(state.myEvents)
  const [leaving, setLeaving] = useState<{ id: string; cls: string } | null>(null)
  const after = useRef<((body: HTMLElement) => void) | null>(null)
  const latest = useRef(state)
  useLayoutEffect(() => { latest.current = state })
  const toggling = useRef(false)

  const view = trail[trail.length - 1]

  const rerender = (mode: Mode, then?: (body: HTMLElement) => void) => {
    setListMine(latest.current.myEvents)
    setRender(r => ({ key: r.key + 1, mode }))
    after.current = then ?? null
  }

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const { mode } = render
    if (view) body.style.setProperty('--base', '0ms')
    if (view && (mode === 'enter' || mode === 'back')) {
      body.scrollTop = 0
      replay(body, mode === 'enter' ? 'slide-in' : 'slide-back')
      if (mode === 'enter') focusQuiet(body.querySelector('[data-view-back]'))
    }
    after.current?.(body)
    after.current = null
    // solo al pintar una vista nueva (cambia la clave)
  }, [render.key])

  const focusFrom = (from: View) => (body: HTMLElement) => {
    const btn = body.querySelector(`[data-${from.type}="${from.id}"]`)
    if (btn) {
      btn.scrollIntoView({ block: 'center' })
      focusQuiet(btn)
    }
  }

  const pushView = (v: View) => {
    if (view && view.type === v.type && view.id === v.id) return
    setTrail([...trail, v])
    rerender('enter')
  }

  const goBack = () => {
    const from = trail[trail.length - 1]
    const rest = trail.slice(0, -1)
    setTrail(rest)
    if (!rest.length) {
      // vuelve a la lista (la pestaña en la que estabas) y enfoca lo que abriste
      rerender('quiet', body => {
        replay(body, 'slide-back')
        focusFrom(from)(body)
      })
      return
    }
    rerender('back', focusFrom(from))
  }

  useLayoutEffect(() => {
    escRef.current = () => {
      if (!trail.length) return false
      goBack()
      return true
    }
  })

  const changeTab = (next: EventsTab) => {
    if (next === tab) return
    setTab(next)
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    rerender('tab')
  }

  const toggleEvent = (id: string, btn: HTMLElement) => {
    if (toggling.current) return
    toggling.current = true
    const had = latest.current.myEvents.includes(id)
    toggle(id)
    replay(btn, 'stamp')

    // dentro de la ficha de una organización el evento se queda; solo se refresca la ficha
    if (view?.type === 'org') {
      setTimeout(() => {
        rerender('refresh', body => focusQuiet(body.querySelector(`[data-toggle="${id}"]`)))
        toggling.current = false
      }, 380)
      return
    }

    setTimeout(() => setLeaving({ id, cls: had ? 'out-right' : 'out-left' }), 220)
    setTimeout(() => {
      setLeaving(null)
      rerender('quiet')
      toggling.current = false
    }, 640)
  }

  const toggleFromDetail = (id: string) => {
    toggle(id)
    rerender('refresh', body => {
      const btn = body.querySelector('[data-ev-toggle]')
      replay(btn, 'stamp')
      focusQuiet(btn)
    })
  }

  const backLabel = () => {
    const prev = trail[trail.length - 2]
    if (!prev) return '← Eventos'
    const name = { event: EV.get(prev.id)?.name, org: ORG.get(prev.id)?.name, person: PEOPLE.find(p => p.id === prev.id)?.name }[prev.type]
    return `← ${name}`
  }

  const people = contacts(state.myEvents, peopleOf(state))
  const mine = new Set(state.myEvents)
  const itemProps = (e: TechEvent, i: number) => ({
    e, i,
    on: mine.has(e.id),
    known: contactsAt(e.id, people),
    leaving: leaving?.id === e.id ? leaving.cls : '',
    onOpen: () => pushView({ type: 'event', id: e.id }),
    onToggle: (btn: HTMLElement) => toggleEvent(e.id, btn),
  })

  if (view?.type === 'event') {
    return (
      <EventView key={render.key} id={view.id} state={state} backLabel={backLabel()}
        onBack={goBack} onOrg={id => pushView({ type: 'org', id })} onPerson={id => pushView({ type: 'person', id })}
        onToggle={toggleFromDetail} />
    )
  }

  if (view?.type === 'person') {
    return <PersonView key={render.key} id={view.id} state={state} backLabel={backLabel()} onBack={goBack} />
  }

  if (view?.type === 'org') {
    const o = ORG.get(view.id)!
    const evs = orgEvents(o)
    const upcoming = evs.filter(e => !isPast(e)).sort(byDateAsc)
    const past = evs.filter(isPast).sort(byDateDesc)
    const went = past.filter(e => mine.has(e.id)).length
    const going = upcoming.filter(e => mine.has(e.id)).length
    const cities = [...new Set(evs.map(e => e.city))].join(' · ')
    const net = people.filter(p => p.events.some(eid => EV.get(eid)?.org === o.id)).length
    let i = 3
    const group = (title: string, list: TechEvent[]) => list.length > 0 && (
      <>
        <h3 className="group-title" style={at(i++)}>{title}</h3>
        {list.map(e => <EvItem key={e.id} {...itemProps(e, i++)} />)}
      </>
    )

    return (
      <div key={render.key} className="stagger org-view" data-id={o.id}>
        <button className="link back-link" type="button" data-view-back style={at(0)} onClick={goBack}>{backLabel()}</button>

        <div className="orgv-head" style={at(1)}>
          <OrgLogo org={o} size="xl" />
          <div>
            <span className="label">Organización</span>
            <strong>{o.name}</strong>
            <span className="orgv-cities">{cities}</span>
          </div>
        </div>

        <dl className="evv-facts" style={at(2)}>
          <div><dt>Eventos</dt><dd>{plural(evs.length, 'evento', 'eventos')}<small>{plural(upcoming.length, 'próximo', 'próximos')} · {plural(past.length, 'celebrado', 'celebrados')}</small></dd></div>
          <div><dt>Tú</dt><dd>{went || going
            ? [went ? `Has ido a ${went}` : '', going ? `vas a ${going}` : ''].filter(Boolean).join(' · ')
            : <span className="muted">Aún no has ido a ninguno</span>}</dd></div>
          <div><dt>Tu red</dt><dd>{net ? `${plural(net, 'persona', 'personas')} con las que coincidiste` : <span className="muted">Nadie de tu red todavía</span>}</dd></div>
        </dl>

        {group('Próximos', upcoming)}
        {group('Anteriores', past)}
      </div>
    )
  }

  // lista
  const listPeople = contacts(listMine, peopleOf(state))
  const listSet = new Set(listMine)
  let groups: [string, TechEvent[]][]
  if (tab === 'mine') {
    const { past, upcoming } = myEventsSplit(listMine)
    groups = [['Próximos', upcoming], ['Asistidos', past]]
  } else {
    const rest = EVENTS.filter(e => !listSet.has(e.id))
    groups = [['Próximamente', rest.filter(e => !isPast(e)).sort(byDateAsc)], ['Ya celebrados', rest.filter(isPast).sort(byDateDesc)]]
  }
  let i = 0
  const items = groups.filter(([, evs]) => evs.length).map(([title, evs]) => (
    <Fragment key={title}>
      <h3 className="group-title" style={at(i++)}>{title}</h3>
      {evs.map(e => <EvItem key={e.id} {...itemProps(e, i++)} known={contactsAt(e.id, listPeople)} />)}
    </Fragment>
  ))
  const { mode } = render

  return (
    <>
      <div className="tabs" role="tablist">
        <button className="tab" type="button" role="tab" aria-selected={tab === 'mine'} onClick={() => changeTab('mine')}>Mis eventos<b>{listMine.length}</b></button>
        <button className="tab" type="button" role="tab" aria-selected={tab === 'discover'} onClick={() => changeTab('discover')}>Descubrir<b>{EVENTS.length - listMine.length}</b></button>
      </div>
      <div
        key={render.key}
        className={`stagger${mode === 'quiet' ? ' quiet' : ''}`}
        role="tabpanel"
        style={mode !== 'initial' ? ({ '--base': '0ms' } as CSSProperties) : undefined}
      >
        {items.length ? items : (
          <p className="empty">{tab === 'mine' ? 'Aún no has marcado ningún evento.' : 'Ya tienes todos los eventos en tu acreditación.'}</p>
        )}
      </div>
    </>
  )
}

interface EvItemProps {
  e: TechEvent
  i: number
  on: boolean
  known: number
  leaving: string
  onOpen: () => void
  onToggle: (btn: HTMLElement) => void
}

function EvItem({ e, i, on, known, leaving, onOpen, onToggle }: EvItemProps) {
  const d = fmtDate(e)
  const past = isPast(e)
  const org = orgOf(e)
  let meta = `${org ? `${org.name} · ` : ''}${e.city}`
  if (known) {
    meta += on
      ? ` · ${past ? 'coincidiste' : 'coincidirás'} con ${known}`
      : ` · ${plural(known, 'contacto', 'contactos')}`
  }

  return (
    <article className={`ev ev-link${leaving ? ` ${leaving}` : ''}`} style={at(i)}>
      <button className="ev-open" type="button" data-event={e.id} aria-label={`Ver ${e.name}`} onClick={onOpen}>
        <span className="ev-date">{d.day} {d.mon}<small>{d.year}</small></span>
        <span className="ev-info">
          <strong><OrgLogo org={org} size="xs" />{e.name}</strong>
          <span>{meta}</span>
        </span>
      </button>
      <button className={`pill${on ? ' is-on' : ''}`} type="button" data-toggle={e.id} aria-pressed={on}
        onClick={ev => onToggle(ev.currentTarget)}>{pillLabel(e, on)}</button>
    </article>
  )
}

/* Ficha de un evento: fechas, enlace y quién va */

interface EventViewProps {
  id: string
  state: BadgeState
  backLabel: string
  onBack: () => void
  onOrg: (id: string) => void
  onPerson: (id: string) => void
  onToggle: (id: string) => void
}

function EventView({ id, state, backLabel, onBack, onOrg, onPerson, onToggle }: EventViewProps) {
  const e = EV.get(id)!
  const past = isPast(e)
  const on = state.myEvents.includes(e.id)
  const r = fmtRange(e)
  const org = orgOf(e)
  const attendees = peopleOf(state).filter(p => p.events.includes(e.id)).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const total = attendees.length + (on ? 1 : 0)
  const { me } = state

  return (
    <div className="stagger event-view" data-id={e.id}>
      <button className="link back-link" type="button" data-view-back style={at(0)} onClick={onBack}>{backLabel}</button>

      <div className="evv-head" style={at(1)}>
        <span className="label">{e.kind} · {whenLabel(e)}</span>
        <strong>{e.name}</strong>
      </div>

      <dl className="evv-facts" style={at(2)}>
        <div><dt>Fecha</dt><dd>{r.text}<small>{r.days > 1 ? `${r.days} días · empieza en ${r.weekday}` : `Un día · ${r.weekday}`}</small></dd></div>
        {org && (
          <div><dt>Organiza</dt><dd>
            <button className="evv-org" type="button" data-org={org.id} aria-label={`Ver ${org.name}`} onClick={() => onOrg(org.id)}>
              <OrgLogo org={org} size="sm" />{org.name}<span aria-hidden="true">→</span>
            </button>
          </dd></div>
        )}
        <div><dt>Lugar</dt><dd>{e.city}</dd></div>
        <div><dt>Web</dt><dd>{e.url
          ? <a className="evv-url" href={e.url} target="_blank" rel="noopener noreferrer">{e.url.replace(/^https?:\/\/(www\.)?/, '')} ↗</a>
          : <span className="muted">Sin enlace todavía</span>}</dd></div>
      </dl>

      <div className="evv-actions" style={at(3)}>
        <button className={`pill${on ? ' is-on' : ''}`} type="button" data-ev-toggle aria-pressed={on} onClick={() => onToggle(e.id)}>{pillLabel(e, on)}</button>
        {!past && <button className="link" type="button" onClick={() => downloadIcs(e)}>Añadir al calendario</button>}
      </div>

      <h3 className="group-title" style={at(4)}>{past ? 'Quién fue' : 'Quién va'} · {total}</h3>
      <ul className="att-list" style={at(5)}>
        {on && (
          <li className="att att-you">
            {me.photo ? <span className="av av-photo"><img src={xProfilePhoto(me.photo)} alt="" /></span> : <Avatar name={me.name} />}
            <span className="p-info"><strong>Tú</strong><span><span className="p-handle">@{me.handle}</span></span></span>
          </li>
        )}
        {attendees.map(p => (
          <li className="att-item" key={p.id}>
            <button className="att att-open" type="button" data-person={p.id} aria-label={`Ver perfil de ${p.name}`} onClick={() => onPerson(p.id)}>
              <Avatar name={p.name} />
              <span className="p-info">
                <strong>{p.name}</strong>
                <span><span className="p-handle">@{p.handle}</span> · {p.role}</span>
              </span>
              <span className="p-chev" aria-hidden="true">→</span>
            </button>
          </li>
        ))}
        {!attendees.length && !on && <li className="empty">Nadie de tu red {past ? 'fue' : 'va'} todavía.</li>}
      </ul>
    </div>
  )
}
