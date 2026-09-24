import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import type { Me } from '../../data/sample'
import { BadgeBack, BadgeFront } from './BadgeFront'
import { focusQuiet, replay } from './dom'
import { EV, LEAN, MOVE_MS, SIDE, contacts, peopleOf, myEventsSplit, plural, type Section } from './model'
import { BioPanel } from './panels/BioPanel'
import { EventsPanel, type EventsTab } from './panels/EventsPanel'
import { PeoplePanel, type PeopleTab } from './panels/PeoplePanel'
import { ShareMenu } from './ShareMenu'
import { useNotify } from './Toast'
import { useBadgeStore } from './useBadgeStore'
import { useAuth } from '../../lib/auth-context'
import { SignOutButton } from '../../lib/SignOutButton'
import { Link } from 'react-router-dom'
import '../../styles/badge.css'

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches
const CAN_HOVER = matchMedia('(hover: hover)').matches
const NARROW = matchMedia('(max-width: 899px)') // mismo corte que badge.css
const SWIPE_SLOP = 10 // px antes de decidir si el gesto es horizontal o un scroll
const SWIPE_COMMIT = .3 // parte del recorrido a partir de la cual, al soltar, la transición se completa
const SWIPE_FLICK = .4 // px/ms: un gesto rápido completa la transición aunque sea corto
const PEEK = 28 // = --peek en badge.css

// duración de lo que falta de un giro cuando ya va por "done" (arrastre)
const restMs = (done: number) => Math.round(Math.max(250, MOVE_MS * (1 - done)))

type Side = 'left' | 'right' | null

/* La escena: la tarjeta gira y se aparta, y el panel aparece al otro lado */

/** sample = acreditación de ejemplo (/ejemplo, o todo en modo demo) */
export function BadgeApp({ sample = false }: { sample?: boolean }) {
  const notify = useNotify()
  const { session } = useAuth()
  const [state, update, ready] = useBadgeStore(sample ? null : session?.user.id ?? null)
  const [current, setCurrent] = useState<Section | null>(null) // sección abierta en el panel
  const [panel, setPanel] = useState<{ section: Section; key: number; mode: 'initial' | 'switch' } | null>(null)
  const [stage, setStage] = useState({ open: false, cardRight: false, panelLeft: false, swapping: false })
  const [draftMe, setDraftMe] = useState<Me | null>(null) // vista previa de la bio sin guardar
  const [evTab, setEvTab] = useState<EventsTab>('mine')
  const [peopleTab, setPeopleTab] = useState<PeopleTab>('match')
  const [shareOpen, setShareOpen] = useState(false)

  const stageRef = useRef<HTMLElement>(null)
  const moverRef = useRef<HTMLDivElement>(null)
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
  // done: parte del giro que ya se hizo con el dedo (arrastre en móvil)
  const spin = (delta: number, done = 0) => {
    const card = cardRef.current!
    const from = turn.current + delta * done
    turn.current += delta
    card.style.transform = `rotateY(${turn.current}deg)`
    if (delta === 0) return
    card.animate(
      [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${turn.current}deg)` }],
      done
        ? { duration: restMs(done), easing: 'cubic-bezier(.2, .8, .2, 1)' }
        : { duration: MOVE_MS, easing: 'cubic-bezier(.65, 0, .25, 1)' },
    )
  }

  // Vuelta completa en el sentido del desplazamiento; null = volver al centro.
  // En móvil no se inclina: solo asoma una franja recta junto al borde.
  const turnTo = (side: Side) => {
    const lift = NARROW.matches ? 0 : LEAN
    const target = side === 'left' ? lift : side === 'right' ? -lift : 0
    const dir = side === 'left' ? 1 : side === 'right' ? -1 : (lean.current > 0 ? -1 : 1)
    return { delta: dir * 360 + target - lean.current, target }
  }
  const goTo = (side: Side, done = 0) => {
    const { delta, target } = turnTo(side)
    spin(delta, done)
    lean.current = target
  }

  const nudge = () => {
    if (REDUCED || NARROW.matches) return
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

  const close = (done = 0) => {
    if (busy.current || !currentRef.current) return
    busy.current = true
    const was = currentRef.current
    setCurrent(null)
    setDraftMe(null)
    goTo(null, done)
    setStage(s => ({ ...s, open: false }))
    setTimeout(() => {
      busy.current = false
      focusQuiet(frontRef.current?.querySelector(`[data-open="${was}"]`))
    }, done ? restMs(done) : MOVE_MS)
  }

  // Al abrir arrastrando la tarjeta no hay zona ni onda, y done es la parte
  // de la transición que ya se hizo con el dedo (el panel ya está pintado).
  const open = (section: Section, zone?: HTMLElement, ev?: MouseEvent, done = 0) => {
    if (busy.current) return
    if (current === section) return close()

    if (zone && ev) ripple(zone, ev)
    const side = SIDE[section]

    if (current) {
      const sameSide = SIDE[current] === side
      const switchZone = () => {
        if (current === 'bio') setDraftMe(null) // descarta la vista previa sin guardar
        setCurrent(section)
      }

      // mismo lado: solo cambia el panel
      if (sameSide) {
        switchZone()
        setStage(s => ({ ...s, cardRight: side === 'right', panelLeft: side === 'right' }))
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
      // la zona activa cambia a mitad del giro, con el anverso de espaldas
      setTimeout(switchZone, MOVE_MS / 2)
      setTimeout(() => {
        busy.current = false
        focusClose()
      }, MOVE_MS)
      return
    }

    busy.current = true
    setCurrent(section)
    if (!done) renderPanel(section, 'initial')
    resetTilt()
    setStage(s => ({ ...s, open: true, cardRight: side === 'right', panelLeft: side === 'right' }))
    goTo(side, done)
    setTimeout(() => {
      busy.current = false
      focusClose()
    }, done ? restMs(done) : MOVE_MS)
  }

  // los manejadores globales leen siempre la última versión de close()
  const closeRef = useRef(close)
  const openRef = useRef(open)
  const turnToRef = useRef(turnTo)
  useLayoutEffect(() => {
    closeRef.current = close
    openRef.current = open
    turnToRef.current = turnTo
  })

  /* ───────── Móvil: arrastrar la tarjeta ─────────
     El dedo lleva la misma transición que el clic: la tarjeta gira y se
     aparta, y el panel aparece. En el centro, arrastrarla a la izquierda
     abre eventos y a la derecha la bio. Con un panel abierto, arrastrar la
     franja que asoma hacia el centro vuelve al menú. Al soltar, la
     transición se completa o vuelve atrás desde donde la dejó el dedo. */
  useEffect(() => {
    const stageEl = stageRef.current
    const mover = moverRef.current
    const card = cardRef.current
    const panelEl = panelRef.current
    const credits = stageEl?.querySelector<HTMLElement>('.credits')
    if (!stageEl || !mover || !card || !panelEl || !credits) return

    type Drag = {
      id: number; x: number; y: number; on: boolean
      closing: boolean // true: desde la franja, con un panel abierto
      side: 'left' | 'right' // lado de la tarjeta cuando está abierta
      dist: number // px que recorre la tarjeta entre el centro y el borde
      p: number // 0..1: parte de la transición hecha
      lastX: number; lastT: number; v: number // velocidad (px/ms) para el gesto rápido
    }
    let drag: Drag | null = null
    let swiped = false
    let settle = 0 // temporizador que quita los estilos del arrastre

    const clear = () => {
      for (const el of [mover, panelEl, credits]) el.style.cssText = ''
    }

    // pinta el estado intermedio: open = 0 (menú) … 1 (panel abierto)
    const paint = (d: Drag) => {
      const { delta } = turnToRef.current(d.closing ? null : d.side)
      const open = d.closing ? 1 - d.p : d.p
      const sign = d.side === 'left' ? -1 : 1
      const shown = Math.min(1, Math.max(0, (open - .35) / .65)) // el panel llega en la segunda mitad
      mover.style.transition = 'none'
      mover.style.transform = `translateX(${sign * open * d.dist}px)`
      card.style.transform = `rotateY(${turn.current + delta * d.p}deg)`
      panelEl.style.transition = 'none'
      panelEl.style.visibility = 'visible'
      panelEl.style.opacity = String(shown)
      panelEl.style.transform = `translateX(${-sign * 48 * (1 - shown)}px)`
      credits.style.transition = 'none'
      credits.style.visibility = 'visible'
      credits.style.opacity = String(1 - open)
    }

    // al abrir desde el centro, el lado se decide (y puede cambiar) con el dedo
    const aim = (d: Drag, side: 'left' | 'right') => {
      if (d.side === side && d.on) return
      d.side = side
      renderPanel(side === 'left' ? 'events' : 'bio', 'initial')
      setStage(s => ({ ...s, cardRight: side === 'right', panelLeft: side === 'right' }))
    }

    const onDown = (e: PointerEvent) => {
      swiped = false
      if (!NARROW.matches || busy.current || !e.isPrimary) return
      const target = e.target as Element
      const side = currentRef.current ? SIDE[currentRef.current] : null
      const base = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, p: 0, lastX: e.clientX, lastT: e.timeStamp, v: 0 }
      const dist = (mover.offsetWidth + innerWidth) / 2 - PEEK
      if (!side && target.closest('.face.front') && !target.closest('.share-btn')) drag = { ...base, closing: false, side: 'left', dist }
      else if (side && target.closest('.peek')) drag = { ...base, closing: true, side, dist }
    }

    const onMove = (e: PointerEvent) => {
      const d = drag
      if (!d || e.pointerId !== d.id) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.on) {
        if (Math.abs(dy) > SWIPE_SLOP && Math.abs(dy) > Math.abs(dx)) { drag = null; return } // es un scroll
        if (Math.abs(dx) < SWIPE_SLOP) return
        if (!d.closing) aim(d, dx < 0 ? 'left' : 'right')
        d.on = true
        clearTimeout(settle)
        clear()
        resetTilt()
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
      } else if (!d.closing && dx !== 0) aim(d, dx < 0 ? 'left' : 'right')

      const dt = e.timeStamp - d.lastT
      if (dt > 0) d.v = (e.clientX - d.lastX) / dt
      d.lastX = e.clientX
      d.lastT = e.timeStamp

      // al abrir, la tarjeta va hacia su lado; al cerrar, hacia el centro
      const toward = d.closing ? (d.side === 'left' ? 1 : -1) : (d.side === 'left' ? -1 : 1)
      d.p = Math.min(1, Math.max(0, (dx * toward) / d.dist))
      paint(d)
    }

    const onUp = (e: PointerEvent) => {
      const d = drag
      if (!d || e.pointerId !== d.id) return
      drag = null
      if (!d.on) return
      swiped = true // el clic que sigue al arrastre no debe abrir ni cerrar nada

      const toward = d.closing ? (d.side === 'left' ? 1 : -1) : (d.side === 'left' ? -1 : 1)
      const v = e.type === 'pointercancel' ? 0 : d.v * toward
      const commit = e.type !== 'pointercancel' && d.p > 0 && (v > SWIPE_FLICK || (d.p >= SWIPE_COMMIT && v > -SWIPE_FLICK))
      const opens = d.closing !== commit // estado final: panel abierto
      const ms = commit ? restMs(d.p) : restMs(1 - d.p)

      // lo pintado con el dedo pasa a una transición CSS hasta el estado final
      mover.style.transition = `transform ${ms}ms cubic-bezier(.2, .8, .2, 1)`
      mover.style.transform = ''
      panelEl.style.transition = `opacity ${ms}ms, transform ${ms}ms cubic-bezier(.2, .8, .2, 1), visibility 0s ${opens ? 0 : ms}ms`
      credits.style.transition = `opacity ${ms}ms, visibility 0s ${opens ? ms : 0}ms`
      for (const el of [panelEl, credits]) {
        el.style.opacity = ''
        el.style.visibility = ''
        el.style.transform = ''
      }
      settle = window.setTimeout(clear, ms)

      if (commit) {
        if (d.closing) closeRef.current(d.p)
        else openRef.current(d.side === 'left' ? 'events' : 'bio', undefined, undefined, d.p)
        return
      }
      // no llega: la tarjeta deshace el giro
      const { delta } = turnToRef.current(d.closing ? null : d.side)
      card.style.transform = `rotateY(${turn.current}deg)`
      card.animate(
        [{ transform: `rotateY(${turn.current + delta * d.p}deg)` }, { transform: `rotateY(${turn.current}deg)` }],
        { duration: ms, easing: 'cubic-bezier(.2, .8, .2, 1)' },
      )
    }

    const onClick = (e: globalThis.MouseEvent) => {
      if (!swiped) return
      swiped = false
      e.preventDefault()
      e.stopPropagation()
    }

    stageEl.addEventListener('pointerdown', onDown)
    stageEl.addEventListener('pointermove', onMove)
    stageEl.addEventListener('pointerup', onUp)
    stageEl.addEventListener('pointercancel', onUp)
    stageEl.addEventListener('click', onClick, true)
    return () => {
      clearTimeout(settle)
      stageEl.removeEventListener('pointerdown', onDown)
      stageEl.removeEventListener('pointermove', onMove)
      stageEl.removeEventListener('pointerup', onUp)
      stageEl.removeEventListener('pointercancel', onUp)
      stageEl.removeEventListener('click', onClick, true)
    }
  }, [ready])

  useEffect(() => {
    // clic en un espacio en blanco (fuera de la acreditación y del panel): volver al menú
    const onClick = (ev: globalThis.MouseEvent) => {
      const target = ev.target as Element
      if (!currentRef.current || !target.isConnected) return
      if (target.closest('.mover, .panel, .toast, .credits, .share, .sign-out')) return
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

  const people = contacts(state.myEvents, peopleOf(state))
  const { past, upcoming } = myEventsSplit(state.myEvents)
  const heads: Record<Section, [string, string]> = {
    bio: ['Tu bio', 'Los cambios se ven al momento en la acreditación.'],
    events: ['Eventos', `${plural(past.length, 'asistido', 'asistidos')} · ${plural(upcoming.length, 'próximo', 'próximos')}${state.live ? ' · fechas de ejemplo' : ''}`],
    people: ['Personas', `Has coincidido con ${plural(people.length, 'persona', 'personas')}.`],
  }

  const stageClass = ['stage', stage.open && 'open', stage.cardRight && 'card-right', stage.panelLeft && 'panel-left', stage.swapping && 'swapping']
    .filter(Boolean).join(' ')

  if (!ready) return <main className="stage" aria-busy="true" />

  return (
    <main className={stageClass} ref={stageRef}>
      {!sample && session && <SignOutButton />}
      <div className="mover" ref={moverRef}>
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
          <PanelContent key={panel.key} section={panel.section} head={heads[panel.section]} bodyRef={bodyRef} onClose={() => close()}>
            {panel.section === 'bio' && (
              <BioPanel me={state.me} onDraft={setDraftMe} onSave={saveBio} onCancel={() => close()} />
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

      {/* móvil: la franja de la acreditación que asoma en el borde vuelve al menú */}
      <button className="peek" type="button" aria-label="Volver a la acreditación" hidden={!stage.open} onClick={() => close()} />

      <ShareMenu open={shareOpen} state={state} anchorRef={shareBtnRef} onClose={closeShare} />

      <footer className="credits">
        {!sample && session && <><Link to="/organizaciones">Organizaciones</Link><span aria-hidden="true"> · </span></>}
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
