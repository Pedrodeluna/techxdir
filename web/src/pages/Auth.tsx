import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { isDemo, supabase } from '../lib/supabase'
import '../styles/badge.css'
import './auth.css'

/* Entrar y registrarse son lo mismo: la primera vez que entras, se crea tu acreditación. */

type Status =
  | { kind: 'idle' }
  | { kind: 'sending'; via: 'x' | 'email' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const redirectTo = () => `${location.origin}/auth/callback`

export function Auth() {
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [emailError, setEmailError] = useState('')

  useEffect(() => {
    document.title = 'techxdir · Recoge tu acreditación'
  }, [])

  if (session) return <Navigate to="/acreditacion" replace />

  const busy = status.kind === 'sending'

  async function withX() {
    if (!supabase) return
    setStatus({ kind: 'sending', via: 'x' })
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'x', options: { redirectTo: redirectTo() } })
    // si va bien, el navegador sale hacia X y no volvemos aquí
    if (error) setStatus({ kind: 'error', message: 'No hemos podido abrir X. Prueba de nuevo o entra con tu email.' })
  }

  async function withEmail(ev: FormEvent) {
    ev.preventDefault()
    const value = email.trim()
    if (!EMAIL_RE.test(value)) {
      setEmailError('Escribe un email válido, como nombre@dominio.com.')
      return
    }
    setEmailError('')
    if (!supabase) return
    setStatus({ kind: 'sending', via: 'email' })
    const { error } = await supabase.auth.signInWithOtp({ email: value, options: { emailRedirectTo: redirectTo() } })
    if (error) {
      const tooMany = error.status === 429
      setStatus({
        kind: 'error',
        message: tooMany
          ? 'Has pedido muchos enlaces seguidos. Espera un minuto y prueba otra vez.'
          : 'No hemos podido enviar el enlace. Revisa el email y prueba otra vez.',
      })
      return
    }
    setStatus({ kind: 'sent', email: value })
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

          {status.kind === 'sent' ? (
            <div className="au-body" role="status">
              <h1 id="au-title">Revisa tu correo</h1>
              <p className="au-lede">
                Te hemos enviado un enlace a <span className="au-email">{status.email}</span>.
                Ábrelo en este dispositivo para entrar. Caduca en una hora.
              </p>
              <div className="au-foot">
                <button type="button" className="link" onClick={() => setStatus({ kind: 'idle' })}>Usar otro email</button>
              </div>
            </div>
          ) : (
            <div className="au-body">
              <h1 id="au-title">Recoge tu acreditación</h1>
              <p className="au-lede">Entra o regístrate. Si es tu primera vez, creamos tu acreditación al momento.</p>

              {isDemo && (
                <p className="au-demo" role="note">
                  Modo demo: falta configurar Supabase en este entorno, así que no se puede entrar.{' '}
                  <Link to="/ejemplo" className="link">Ver una acreditación de ejemplo</Link>
                </p>
              )}

              <button type="button" className="au-x" onClick={withX} disabled={isDemo || busy} aria-busy={status.kind === 'sending' && status.via === 'x'}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                {status.kind === 'sending' && status.via === 'x' ? 'Abriendo X…' : 'Continuar con X'}
              </button>

              <div className="au-or" aria-hidden="true"><span>o con tu email</span></div>

              <form onSubmit={withEmail} noValidate>
                <label className={`field${emailError ? ' invalid' : ''}`}>
                  <span>Email</span>
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="nombre@dominio.com"
                    value={email}
                    onChange={ev => setEmail(ev.target.value)}
                    disabled={isDemo || busy}
                    aria-invalid={Boolean(emailError)}
                    aria-describedby={emailError ? 'au-email-error' : undefined}
                  />
                </label>
                {emailError && <p className="au-error" id="au-email-error">{emailError}</p>}
                <button className="primary au-submit" type="submit" disabled={isDemo || busy}>
                  {status.kind === 'sending' && status.via === 'email' ? 'Enviando…' : 'Enviarme un enlace'}
                </button>
              </form>

              {status.kind === 'error' && <p className="au-error" role="alert">{status.message}</p>}
            </div>
          )}

          <div className="foot au-badge-foot">
            <span className="tier">Sin contraseñas</span>
            <span className="tier">{new Date().getFullYear()}</span>
          </div>
        </section>
      </main>
    </div>
  )
}
