import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import type { Me } from '../../data/sample'
import { BadgeBack, BadgeFront } from './BadgeFront'
import { focusQuiet, replay } from './dom'
import { EV, LEAN, MOVE_MS, SIDE, contacts, myEventsSplit, plural, type Section } from './model'
import { BioPanel } from './panels/BioPanel'
import { EventsPanel, type EventsTab } from './panels/EventsPanel'
import { PeoplePanel, type PeopleTab } from './panels/PeoplePanel'
import { ShareMenu } from './ShareMenu'
import { useNotify } from './Toast'
import { useBadgeStore } from './useBadgeStore'
import '../../styles/badge.css'

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches
const CAN_HOVER = matchMedia('(hover: hover)').matches

type Side = 'left' | 'right' | null

/* La escena: la tarjeta gira y se aparta, y el panel aparece al otro lado */

export function BadgeApp() {
  const notify = useNotify()
  const [state, update] = useBadgeStore()
  const [current, setCurrent] = useState<Section | null>(null) // sección abierta en el panel
  const [panel, setPanel] = useState<{ section: Section; key: number; mode: 'initial' | 'switch' } | null>(null)
  const [stage, setStage] = useState({ open: false, cardRight: false, panelLeft: false, swapping: false })
  const [draftMe, setDraftMe] = useState<Me | null>(null) // vista previa de la bio sin guardar
  const [evTab, setEvTab] = useState<EventsTab>('mine')
  const [peopleTab, setPeopleTab] = useState<PeopleTab>('match')
  const [shareOpen, setShareOpen] = useState(false)

  const cardRef = useRef<HTMLDivElement>(null)
  const tiltRef = useRef<HTMLDivElement>(null)
  const frontRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const shareBtnRef = useRef<HTMLButtonElement>(null)
  const escRef = useRef<(() => boolean) | null>(null)
  const busy = useRef(false) // evita dobles clics mientras gira
  const turn = useRef(0) // ángulo acumulado de la tarjeta
  const lean = useRef(0) // inclinación final actual (0, LEAN o -LEAN)
  const currentRef = useRef(current)
  useLayoutEffect(() => { currentRef.current = current })

  useEffect(() => {
    document.body.classList.add('is-badge')
    document.title = 'techxdir · Acreditación'
    return () => document.body.classList.remove('is-badge')
  }, [])

  /* ───────── Movimiento de la tarjeta ───────── */

  // Giro sobre el eje vertical (rotateY). Se hace con Web Animations para que
  // ocurra siempre, sin depender de transiciones CSS ni de "reducir movimiento".
  const spin = (delta: number) => {
    const card = cardRef.current!
    const from = turn.current
    turn.current += delta
    card.style.transform = `rotateY(${turn.current}deg)`
    card.animate(
      [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${turn.current}deg)` }],
      { duration: MOVE_MS, easing: 'cubic-bezier(.65, 0, .25, 1)' },
    )
  }

  // Vuelta completa en el sentido del desplazamiento; null = volver al centro.
  const goTo = (side: Side) => {
    const target = side === 'left' ? LEAN : side === 'right' ? -LEAN : 0
    const dir = side === 'left' ? 1 : side === 'right' ? -1 : (lean.current > 0 ? -1 : 1)
    spin(dir * 360 + target - lean.current)
    lean.current = target
  }

  const nudge = () => {
    if (REDUCED) return
    tiltRef.current?.animate(
      [{ rotate: 'y 0deg' }, { rotate: 'y -9deg' }, { rotate: 'y 0deg' }],
      { duration: 550, easing: 'cubic-bezier(.3,0,.2,1)' },
    )
  }

  const resetTilt = () => {
    const tilt = tiltRef.current
    if (!tilt) return
    tilt.classList.remove('tracking')
    tilt.style.setProperty('--rx', '0deg')
    tilt.style.setProperty('--ry', '0deg')
  }

  useEffect(() => {
    const tilt = tiltRef.current
    if (!CAN_HOVER || REDUCED || !tilt) return
    const onMove = (e: PointerEvent) => {
      if (currentRef.current || busy.current) return
      const r = cardRef.current!.getBoundingClientRect()
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
      tilt.classList.add('tracking')
      tilt.style.setProperty('--rx', `${((.5 - y) * 6).toFixed(2)}deg`)
      tilt.style.setProperty('--ry', `${((x - .5) * 8).toFixed(2)}deg`)
    }
    tilt.addEventListener('pointermove', onMove)
    tilt.addEventListener('pointerleave', resetTilt)
    return () => {
      tilt.removeEventListener('pointermove', onMove)
      tilt.removeEventListener('pointerleave', resetTilt)
    }
  }, [])

  const ripple = (zone: HTMLElement, ev: MouseEvent) => {
    const r = zone.getBoundingClientRect()
    const fromPointer = ev.detail > 0
    const scale = r.width / zone.offsetWidth || 1 // en móvil la tarjeta está escalada
    const dot = document.createElement('span')
    dot.className = 'ripple'
    dot.style.left = `${(fromPointer ? ev.clientX - r.left : r.width / 2) / scale}px`
    dot.style.top = `${(fromPointer ? ev.clientY - r.top : r.height / 2) / scale}px`
    zone.appendChild(dot)
    dot.addEventListener('animationend', () => dot.remove())
  }

  /* ───────── Panel ───────── */

  const renderPanel = (section: Section, mode: 'initial' | 'switch') =>
    setPanel(p => ({ section, mode, key: (p?.key ?? 0) + 1 }))

  useLayoutEffect(() => {
    if (!panel) return
    bodyRef.current?.style.setProperty('--base', panel.mode === 'initial' ? '600ms' : '80ms')
    if (panel.mode === 'switch') replay(panelRef.current, 'swap')
  }, [panel])

  const focusClose = () => focusQuiet(panelRef.current?.querySelector('[data-close]'))

  /* ───────── Abrir / cambiar / cerrar ───────── */

  const close = () => {
    if (busy.current || !currentRef.current) return
    busy.current = true
    const was = currentRef.current
    setCurrent(null)
    setDraftMe(null)
    goTo(null)
    setStage(s => ({ ...s, open: false }))
    setTimeout(() => {
      busy.current = false
      focusQuiet(frontRef.current?.querySelector(`[data-open="${was}"]`))
    }, MOVE_MS)
  }

  const open = (section: Section, zone: HTMLElement, ev: MouseEvent) => {
    if (busy.current) return
    if (current === section) return close()

    ripple(zone, ev)
    const side = SIDE[section]

    if (current) {
      const sameSide = SIDE[current] === side
      if (current === 'bio') setDraftMe(null) // descarta la vista previa sin guardar
      setCurrent(section)

      // mismo lado: solo cambia el panel
      if (sameSide) {
        renderPanel(section, 'switch')
        nudge()
        return
      }

      // otro lado: la tarjeta cruza girando y el panel reaparece en el lado contrario
      busy.current = true
      setStage(s => ({ ...s, swapping: true, cardRight: side === 'right' }))
      goTo(side)
      setTimeout(() => {
        renderPanel(section, 'initial')
        setStage(s => ({ ...s, panelLeft: side === 'right', swapping: false }))
      }, 250)
      setTimeout(() => {
        busy.current = false
        focusClose()
      }, MOVE_MS)
      return
    }

    busy.current = true
    setCurrent(section)
    renderPanel(section, 'initial')
    resetTilt()
    setStage(s => ({ ...s, open: true, cardRight: side === 'right', panelLeft: side === 'right' }))
    goTo(side)
    setTimeout(() => {
      busy.current = false
      focusClose()
    }, MOVE_MS)
  }

  // los manejadores globales leen siempre la última versión de close()
  const closeRef = useRef(close)
  useLayoutEffect(() => { closeRef.current = close })

  useEffect(() => {
    // clic en un espacio en blanco (fuera de la acreditación y del panel): volver al menú
    const onClick = (ev: globalThis.MouseEvent) => {
      const target = ev.target as Element
      if (!currentRef.current || !target.isConnected) return
      if (target.closest('.mover, .panel, .toast, .credits, .share')) return
      closeRef.current()
    }
    // desde una ficha de evento u organización, Esc vuelve un paso atrás
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !currentRef.current) return
      if (currentRef.current === 'events' && escRef.current?.()) return
      closeRef.current()
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  /* ───────── Datos ───────── */

  const toggle = (id: string) => {
    const e = EV.get(id)!
    const had = state.myEvents.includes(id)
    const ok = update({ ...state, myEvents: had ? state.myEvents.filter(x => x !== id) : [...state.myEvents, id] })
    notify(had ? `${e.name} quitado` : `${e.name} añadido a tu acreditación`)
    return ok
  }

  const saveBio = (me: Me) => {
    notify(update({ ...state, me }) ? 'Acreditación actualizada' : 'Actualizada (no se pudo guardar en este navegador)')
    setDraftMe(null)
    close()
  }

  const closeShare = useCallback((focusBtn: boolean) => {
    setShareOpen(false)
    if (focusBtn) focusQuiet(shareBtnRef.current)
  }, [])

  const people = contacts(state.myEvents)
  const { past, upcoming } = myEventsSplit(state.myEvents)
  const heads: Record<Section, [string, string]> = {
    bio: ['Tu bio', 'Los cambios se ven al momento en la acreditación.'],
    events: ['Eventos', `${plural(past.length, 'asistido', 'asistidos')} · ${plural(upcoming.length, 'próximo', 'próximos')}`],
    people: ['Personas', `Has coincidido con ${plural(people.length, 'persona', 'personas')}.`],
  }

  const stageClass = ['stage', stage.open && 'open', stage.cardRight && 'card-right', stage.panelLeft && 'panel-left', stage.swapping && 'swapping']
    .filter(Boolean).join(' ')

  return (
    <main className={stageClass}>
      <div className="mover">
        <div className="tilt" ref={tiltRef}>
          <div className="card" ref={cardRef}>
            <BadgeFront
              faceRef={frontRef}
              state={draftMe ? { ...state, me: draftMe } : state}
              current={current}
              shareOpen={shareOpen}
              shareBtnRef={shareBtnRef}
              onOpen={open}
              onShare={() => {
                resetTilt() // la tarjeta se queda plana mientras el menú está abierto
                setShareOpen(o => !o)
              }}
            />
            <BadgeBack />
          </div>
        </div>
      </div>

      <aside className="panel" ref={panelRef} aria-live="polite" inert={!stage.open}>
        {panel && (
          <PanelContent key={panel.key} section={panel.section} head={heads[panel.section]} bodyRef={bodyRef} onClose={close}>
            {panel.section === 'bio' && (
              <BioPanel me={state.me} onDraft={setDraftMe} onSave={saveBio} onCancel={close} />
            )}
            {panel.section === 'events' && (
              <EventsPanel state={state} toggle={toggle} bodyRef={bodyRef} tab={evTab} setTab={setEvTab} escRef={escRef} />
            )}
            {panel.section === 'people' && (
              <PeoplePanel state={state} bodyRef={bodyRef} tab={peopleTab} setTab={setPeopleTab} />
            )}
          </PanelContent>
        )}
      </aside>

      <ShareMenu open={shareOpen} state={state} anchorRef={shareBtnRef} onClose={closeShare} />

      <footer className="credits">
        A side project by{' '}
        <a href="https://x.com/pedrodelunah" target="_blank" rel="noopener noreferrer">@pedrodelunah</a>,{' '}
        <a href="https://x.com/franms_dev" target="_blank" rel="noopener noreferrer">@franms_dev</a>
        {' '}and <a href="https://x.com/elashera" target="_blank" rel="noopener noreferrer">@elashera</a>
      </footer>
    </main>
  )
}

interface PanelContentProps {
  section: Section
  head: [string, string]
  bodyRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  children: ReactNode
}

function PanelContent({ section, head: [title, sub], bodyRef, onClose, children }: PanelContentProps) {
  return (
    <>
      <header className="panel-head">
        <div>
          <span className="label">{section === 'bio' ? 'Editar' : 'Tu acreditación'}</span>
          <h2>{title}</h2>
          <p>{sub}</p>
        </div>
        <button className="close" type="button" data-close aria-label="Cerrar" onClick={onClose}>×</button>
      </header>
      <div className="panel-body" ref={bodyRef}>{children}</div>
    </>
  )
}
