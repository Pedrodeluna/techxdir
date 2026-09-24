import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { SignOutButton } from '../lib/SignOutButton'
import { BadgeBack, BadgeFront } from '../features/badge/BadgeFront'
import { DEFAULT_ME, DEFAULT_MY_EVENTS, EVENTS, byDateAsc, fmtDate, isPast, orgOf, plural, type Section } from '../features/badge/model'
import '../styles/badge.css'
import './landing.css'

/* Landing: el programa impreso que te dan con la acreditación */

const SAMPLE_STATE = { me: DEFAULT_ME, myEvents: DEFAULT_MY_EVENTS }
// el programa cabe en la primera pantalla: para ver el resto hay que entrar
const RECENT_PAST = 2
const NEXT_UP = 4
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches

export function Landing() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const cardRef = useRef<HTMLDivElement>(null)
  const [lit, setLit] = useState<Section | null>(null)
  // el programa arranca con los últimos eventos celebrados y sigue con los próximos
  const sorted = [...EVENTS].sort(byDateAsc)
  const upcomingAt = sorted.findIndex(e => !isPast(e))
  const firstShown = upcomingAt < 0 ? sorted.length : upcomingAt
  const events = sorted.slice(Math.max(0, firstShown - RECENT_PAST), firstShown + NEXT_UP)
  const more = sorted.length - firstShown - NEXT_UP
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

  return (
    <div className="lp">
      <header className="lp-top">
        <Link to="/" className="wordmark lp-mark">techx<b>dir</b></Link>
        {session && <SignOutButton />}
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
                onOpen={() => navigate('/ejemplo')}
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
          <p className="lp-fine">
            {more > 0 && <>Y {plural(more, 'evento más', 'eventos más')}: recoge tu acreditación para verlos. </>}
            No hablamos en nombre de los organizadores.
          </p>
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
