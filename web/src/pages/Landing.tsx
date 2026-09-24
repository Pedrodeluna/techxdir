import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { SignOutButton } from '../lib/SignOutButton'
import { BadgeBack, BadgeFront } from '../features/badge/BadgeFront'
import { DEFAULT_ME, DEFAULT_MY_EVENTS, EVENTS, byDateAsc, fmtDate, isPast, orgOf, type Section } from '../features/badge/model'
import '../styles/badge.css'
import './landing.css'

/* Landing: el programa impreso que te dan con la acreditación */

const SAMPLE_STATE = { me: DEFAULT_ME, myEvents: DEFAULT_MY_EVENTS }
const RECENT_PAST = 3
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches

const ZONES: { id: Section; slot: string; title: string; text: string }[] = [
  { id: 'bio', slot: 'Foto', title: 'Tu bio', text: 'Cambia nombre, rol y bio. La acreditación se actualiza mientras escribes.' },
  { id: 'events', slot: 'Eventos', title: 'Dónde has estado', text: 'Marca los eventos a los que fuiste y a los que irás.' },
  { id: 'people', slot: 'Coincidencias', title: 'Con quién coincidiste', text: 'Las personas aparecen porque estuvisteis en el mismo evento, no porque os sigáis.' },
]

export function Landing() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const cardRef = useRef<HTMLDivElement>(null)
  const [lit, setLit] = useState<Section | null>(null)
  const [focusZone, setFocusZone] = useState<Section | null>(null)
  // el programa arranca con los últimos eventos celebrados y sigue con los próximos
  const sorted = [...EVENTS].sort(byDateAsc)
  const upcomingAt = sorted.findIndex(e => !isPast(e))
  const events = sorted.slice(Math.max(0, (upcomingAt < 0 ? sorted.length : upcomingAt) - RECENT_PAST))
  const firstUpcoming = events.findIndex(e => !isPast(e))
  const today = new Date()
  const todayLabel = today.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '')

  useEffect(() => {
    document.title = 'techxdir · Tu acreditación de eventos tech'
  }, [])

  // la acreditación llega girando, como en la app: la trasera primero y luego el anverso
  useEffect(() => {
    if (REDUCED) return
    cardRef.current?.animate(
      [{ transform: 'rotateY(-180deg)' }, { transform: 'rotateY(0deg)' }],
      { duration: 1400, delay: 250, easing: 'cubic-bezier(.65, 0, .25, 1)', fill: 'backwards' },
    )
  }, [])

  // tocar una zona de la acreditación lleva a su entrada del programa
  const openZone = (section: Section) => {
    setFocusZone(section)
    document.getElementById(`zona-${section}`)?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' })
  }

  return (
    <div className="lp">
      <header className="lp-top">
        <Link to="/" className="wordmark lp-mark">techx<b>dir</b></Link>
        {session ? <SignOutButton /> : <Link to="/entrar" className="lp-enter">Entrar</Link>}
      </header>

      <main className="lp-main">
        <h1 id="lp-title" className="lp-title">Tu acreditación es el menú.</h1>

        <section className="lp-intro" aria-labelledby="lp-title">
          <p className="lp-lede">
            Guarda los eventos tech a los que vas y las personas con las que coincides en ellos.
          </p>
          <div className="lp-actions">
            <Link to="/entrar" className="primary lp-cta">Recoge tu acreditación</Link>
            <Link to="/ejemplo" className="link">Ver una de ejemplo</Link>
          </div>
        </section>

        <aside className="lp-badge" aria-label="Acreditación de ejemplo">
          <div className="lp-hang">
            <div className="card" ref={cardRef}>
              <BadgeFront
                state={SAMPLE_STATE}
                current={lit}
                shareOpen={false}
                faceRef={null}
                shareBtnRef={null}
                onOpen={openZone}
                onShare={() => navigate('/entrar')}
              />
              <BadgeBack />
            </div>
          </div>
          <p className="lp-note">Ejemplo · Alex y sus contactos son inventados</p>
        </aside>

        <section className="lp-programme" aria-labelledby="lp-prog">
          <h2 id="lp-prog" className="label">Programa · fechas de ejemplo</h2>
          <table className="lp-table">
            <thead className="sr-only">
              <tr><th>Fecha</th><th>Evento</th><th>Ciudad</th><th>Tipo</th></tr>
            </thead>
            <tbody>
              {events.map((e, i) => {
                const d = fmtDate(e)
                return [
                  i === firstUpcoming && (
                    <tr className="lp-today" key="hoy" aria-label={`Hoy, ${todayLabel}`}>
                      <td colSpan={4}><span>Hoy · {todayLabel}</span></td>
                    </tr>
                  ),
                  <tr
                    key={e.id}
                    className={isPast(e) ? 'is-past' : undefined}
                    onPointerEnter={() => setLit('events')}
                    onPointerLeave={() => setLit(null)}
                  >
                    <td className="lp-date">{d.day} {d.mon}<small>{d.year}</small></td>
                    <td className="lp-ev">{e.name}<small>{orgOf(e)?.name}</small></td>
                    <td className="lp-city">{e.city}</td>
                    <td className="lp-kind">{e.kind}</td>
                  </tr>,
                ]
              })}
            </tbody>
          </table>
          <p className="lp-fine">Los nombres de los eventos son reales. Las fechas son de ejemplo hasta que conectemos el calendario. No hablamos en nombre de los organizadores.</p>
        </section>

        <section className="lp-zones" aria-labelledby="lp-zones-title">
          <h2 id="lp-zones-title" className="label">Cómo se usa · toca la acreditación</h2>
          <table className="lp-table lp-howto">
            <thead className="sr-only">
              <tr><th>Zona</th><th>Qué hace</th></tr>
            </thead>
            <tbody>
              {ZONES.map(z => (
                <tr
                  key={z.id}
                  id={`zona-${z.id}`}
                  className={focusZone === z.id ? 'is-on' : undefined}
                  onPointerEnter={() => setLit(z.id)}
                  onPointerLeave={() => setLit(null)}
                >
                  <td className="lp-date">{z.slot}</td>
                  <td className="lp-ev">{z.title}<small>{z.text}</small></td>
                </tr>
              ))}
              <tr className="lp-last">
                <td className="lp-date">Tú</td>
                <td className="lp-ev">
                  Recoge la tuya<small>Con tu cuenta de X o con tu email. Sin contraseñas.</small>
                  <Link to="/entrar" className="primary lp-cta">Recoge tu acreditación</Link>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </main>

      <footer className="credits lp-credits">
        Un proyecto de{' '}
        <a href="https://x.com/pedrodelunah" target="_blank" rel="noopener noreferrer">@pedrodelunah</a>,{' '}
        <a href="https://x.com/franms_dev" target="_blank" rel="noopener noreferrer">@franms_dev</a>
        {' '}y <a href="https://x.com/elashera" target="_blank" rel="noopener noreferrer">@elashera</a>
      </footer>
    </div>
  )
}
