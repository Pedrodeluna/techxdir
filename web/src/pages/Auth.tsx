import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { isDemo, supabase } from '../lib/supabase'
import '../styles/badge.css'
import './auth.css'

/* Entrar y registrarse son lo mismo: la primera vez que entras, se crea tu acreditación. */

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'error'; message: string }

const redirectTo = () => `${location.origin}/auth/callback`
const xProvider = import.meta.env.VITE_X_AUTH_PROVIDER === 'x' ? 'x' : 'twitter'

export function Auth() {
  const { session } = useAuth()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    document.title = 'techxdir · Recoge tu acreditación'
  }, [])

  if (session) return <Navigate to="/acreditacion" replace />

  const busy = status.kind === 'sending'

  async function withX() {
    if (!supabase) return
    setStatus({ kind: 'sending' })
    const { error } = await supabase.auth.signInWithOAuth({ provider: xProvider, options: { redirectTo: redirectTo() } })
    // si va bien, el navegador sale hacia X y no volvemos aquí
    if (error) setStatus({ kind: 'error', message: 'No hemos podido abrir X. Prueba de nuevo.' })
  }

  return (
    <div className="au">
      <header className="au-top">
        <Link to="/" className="wordmark au-mark">techx<b>dir</b></Link>
      </header>

      <main className="au-stage">
        <section className="au-badge" aria-labelledby="au-title">
          <span className="slot" aria-hidden="true" />
          <div className="top">
            <span className="wordmark">techx<b>dir</b></span>
            <span className="tier">Attendee</span>
          </div>

          <div className="au-body">
            <h1 id="au-title">Recoge tu acreditación</h1>
            <p className="au-lede">Entra o regístrate. Si es tu primera vez, creamos tu acreditación al momento.</p>

            {isDemo && (
              <p className="au-demo" role="note">
                Modo demo: falta configurar Supabase en este entorno, así que no se puede entrar.{' '}
                <Link to="/ejemplo" className="link">Ver una acreditación de ejemplo</Link>
              </p>
            )}

            <button type="button" className="au-x" onClick={withX} disabled={isDemo || busy} aria-busy={busy}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              {busy ? 'Abriendo X…' : 'Continuar con X'}
            </button>

            {status.kind === 'error' && <p className="au-error" role="alert">{status.message}</p>}
          </div>

          <div className="foot au-badge-foot">
            <span className="tier">{new Date().getFullYear()}</span>
          </div>
        </section>
      </main>
    </div>
  )
}
