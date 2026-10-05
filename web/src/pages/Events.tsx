import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { EventMap } from '../features/events/EventMap'
import { useCatalog } from '../features/events/catalog'
import { useAuth } from '../lib/auth-context'
import '../styles/badge.css'
import './events.css'

export function Events() {
  const { catalog, loading, error, retry } = useCatalog()
  const { session } = useAuth()
  const { state } = useLocation()
  const from = state?.from
  const backTo = from === '/ejemplo' || from === '/acreditacion'
    ? from
    : session ? '/acreditacion' : '/'

  useEffect(() => {
    document.title = 'techxdir · Mapa y eventos'
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="events-page">
      <header className="events-top">
        <Link to="/" className="wordmark">techx<b>dir</b></Link>
        <Link to={backTo} className="events-back">← {backTo === '/' ? 'Inicio' : 'Acreditación'}</Link>
      </header>
      <main className="events-main">
        {loading || error ? (
          <section className="events-status">
            <h1>Mapa y eventos.</h1>
            {loading ? <p role="status">Cargando encuentros…</p> : (
              <p role="alert">No se ha podido cargar la agenda. <button type="button" className="link" onClick={retry}>Reintentar</button></p>
            )}
          </section>
        ) : <EventMap events={catalog.events} expanded />}
      </main>
    </div>
  )
}
