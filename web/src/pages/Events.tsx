import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { SiteHeader } from '../components/SiteHeader'
import { EventMap } from '../features/events/EventMap'
import { useCatalog } from '../features/events/catalog'
import { useAuth } from '../lib/auth-context'
import '../styles/badge.css'
import './events.css'

export function Events() {
  const { catalog, loading, error, retry } = useCatalog()
  const { session } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    document.title = 'techxdir · Mapa y eventos'
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="events-page">
      <SiteHeader />
      <main className="events-main">
        <Link to="/#encuentros" className="events-back">← Volver a Inicio</Link>
        {loading || error ? (
          <section className="events-status">
            <h1>Mapa y eventos.</h1>
            {loading ? <p role="status">Cargando encuentros…</p> : (
              <p role="alert">No se ha podido cargar la agenda. <button type="button" className="link" onClick={retry}>Reintentar</button></p>
            )}
          </section>
        ) : <EventMap events={catalog.events} expanded persistenceKey="techxdir:explore" onOpen={session ? id => navigate(`/?event=${encodeURIComponent(id)}`) : undefined} />}
      </main>
    </div>
  )
}
