import type { MouseEvent, Ref } from 'react'
import { Avatar, OrgLogo, Photo } from './bits'
import { cardId, contacts, peopleOf, fmtDate, joinedYear, myEventsSplit, myOrgs, tierLabel, type BadgeState, type Section } from './model'

/* Anverso: la acreditación es el menú */

interface Props {
  faceRef: Ref<HTMLElement>
  state: BadgeState
  current: Section | null
  shareOpen: boolean
  shareBtnRef: Ref<HTMLButtonElement>
  onOpen: (section: Section, zone: HTMLElement, ev: MouseEvent) => void
  onShare: () => void
}

export function BadgeFront({ faceRef, state, current, shareOpen, shareBtnRef, onOpen, onShare }: Props) {
  const { me } = state
  const { past, upcoming } = myEventsSplit(state.myEvents)
  const people = contacts(state.myEvents, peopleOf(state))
  const shown = people.slice(0, 4)
  const orgs = myOrgs(state.myEvents)
  const orgsShown = orgs.slice(0, 4)

  let sub = null
  if (state.live) {
    // con sesión las fechas aún son de ejemplo: no se muestran en la acreditación
  } else if (upcoming[0]) {
    const d = fmtDate(upcoming[0])
    sub = <>Próximo<b>{upcoming[0].short} · {d.day} {d.mon}</b></>
  } else if (past[0]) {
    const d = fmtDate(past[0])
    sub = <>Último<b>{past[0].short} · {d.mon} {d.year}</b></>
  }

  const zone = (section: Section, extra: string) => ({
    className: `zone ${extra}${current === section ? ' active' : ''}`,
    type: 'button' as const,
    'data-open': section,
    onClick: (ev: MouseEvent<HTMLButtonElement>) => onOpen(section, ev.currentTarget, ev),
  })

  const role = [me.role, me.company].filter(Boolean).join(' · ')

  return (
    <section ref={faceRef} className="face front" aria-label="Acreditación">
      <span className="slot" aria-hidden="true" />
      <div className="top">
        <span className="wordmark">techx<b>dir</b></span>
        <span className="tier">{tierLabel(me)}</span>
      </div>

      <div className="grid">
        <button {...zone('bio', 'zone-photo')} aria-label="Editar foto y bio">
          <Photo photo={me.photo} name={me.name} />
          <span className="photo-tag">Editar</span>
        </button>

        <button {...zone('events', 'zone-events')} aria-label={`Ver mis eventos (${past.length} asistidos)`}>
          <span className="label">Eventos</span>
          {orgsShown.length > 0 && (
            <span className="ev-orgs" title="Organizaciones de tus eventos">
              {orgsShown.map(o => <OrgLogo key={o.id} org={o} />)}
              {orgs.length > orgsShown.length && <span className="org-more">+{orgs.length - orgsShown.length}</span>}
            </span>
          )}
          <strong className="num">{past.length}</strong>
          {sub && <span className="sub">{sub}</span>}
        </button>

        <button {...zone('bio', 'zone-id')} aria-label="Editar bio">
          <strong className="name">{me.name || 'Tu nombre'}</strong>
          <span className="role">{role || ' '}</span>
          <span className="handle">@{me.handle}</span>
        </button>

        <button {...zone('people', 'zone-people')} aria-label={`Ver personas con las que has coincidido (${people.length})`}>
          <span className="label">Coincidencias</span>
          <span className="people-row">
            <span><strong className="num">{people.length}</strong><span className="unit">{people.length === 1 ? 'persona' : 'personas'}</span></span>
            <span className="stack">
              {shown.map(p => <Avatar key={p.id} name={p.name} />)}
              {people.length > shown.length && <span className="av more">+{people.length - shown.length}</span>}
            </span>
          </span>
        </button>
      </div>

      <div className="foot">
        <button
          ref={shareBtnRef}
          className="share-btn"
          type="button"
          aria-haspopup="menu"
          aria-controls="shareMenu"
          aria-expanded={shareOpen}
          title={cardId(me)}
          onClick={onShare}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" /></svg>
          Compartir
        </button>
        <span className="tier">Desde {joinedYear(me)}</span>
      </div>
    </section>
  )
}

export function BadgeBack() {
  return (
    <div className="face back" aria-hidden="true">
      <span className="slot" />
      <span className="back-mark">techx<b>dir</b></span>
      <span className="back-foot">ATTENDEE · 2026</span>
    </div>
  )
}
