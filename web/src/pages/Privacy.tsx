import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { isDemo, supabase } from '../lib/supabase'
import '../styles/badge.css'
import './auth.css'
import './privacy.css'

/* Qué importamos de Luma y Meetup, y cómo dejar de aparecer. */

const xProvider = import.meta.env.VITE_X_AUTH_PROVIDER === 'x' ? 'x' : 'twitter'
const contactEmail: string | undefined = import.meta.env.VITE_PRIVACY_EMAIL || undefined

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; text: string } | { kind: 'error'; text: string }

export function Privacy() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const busy = status.kind === 'busy'

  useEffect(() => {
    document.title = 'techxdir · Privacidad'
    if (location.hash === '#ocultarme') document.getElementById('ocultarme')?.scrollIntoView()
  }, [])

  async function signIn() {
    if (!supabase) return
    setStatus({ kind: 'busy' })
    const { error } = await supabase.auth.signInWithOAuth({
      provider: xProvider,
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent('/privacidad#ocultarme')}` },
    })
    if (error) setStatus({ kind: 'error', text: 'No hemos podido abrir X. Prueba de nuevo.' })
  }

  // null: hide_me borra la cuenta solo si se acaba de crear para esto
  // (menos de 30 minutos, sin asistencias, sin gestionar nada).
  async function hide(deleteAccount: boolean | null) {
    if (!supabase) return
    setStatus({ kind: 'busy' })
    const { data: deleted, error } = await supabase.rpc('hide_me', { delete_account: deleteAccount })
    if (error) {
      setStatus({ kind: 'error', text: error.code === '42501'
        ? 'Necesitamos que entres con X para saber que la cuenta es tuya.'
        : 'No hemos podido completarlo. Prueba de nuevo.' })
      return
    }
    if (deleted === true) {
      await supabase.auth.signOut()
      navigate('/', { replace: true })
      return
    }
    setStatus({ kind: 'done', text: 'Hecho. Hemos borrado lo que importamos de Luma sobre ti y no volverás a aparecer.' })
  }

  return (
    <div className="au pv">
      <header className="au-top">
        <Link to="/" className="wordmark au-mark">techx<b>dir</b></Link>
      </header>
      <main className="pv-main">
        <h1>Privacidad</h1>
        <p className="pv-lede">techxdir junta la gente que coincide en eventos tech de España. Esto es lo que leemos y por qué.</p>

        <h2>Eventos</h2>
        <p>Importamos los eventos públicos de los calendarios de Luma y de los grupos de Meetup que añaden las comunidades. Solo guardamos el nombre, la fecha, la ciudad y el enlace.</p>

        <h2>Asistentes</h2>
        <p>De Luma leemos solo la muestra pública de invitados que el propio evento enseña (anfitriones y asistentes destacados), y solo de quien ha puesto su usuario de X en su perfil de Luma. Guardamos ese usuario, el nombre y la foto.</p>
        <ul>
          <li>Solo lo ven las personas que han entrado en techxdir, nunca las acreditaciones públicas.</li>
          <li>Si entras con ese mismo X, te proponemos los eventos para que los confirmes. No aparecen en tu acreditación hasta que lo haces.</li>
          <li>Borramos a quien no ha vuelto a aparecer en ningún evento en 12 meses.</li>
        </ul>

        <section id="ocultarme" className="pv-hide" aria-labelledby="pv-hide-title">
          <h2 id="pv-hide-title">Ocultarme</h2>
          <p>Entra con tu X para demostrar que es tuyo. Borramos lo importado y no volvemos a guardar ese usuario.</p>
          {isDemo && <p role="note">Modo demo: no se puede entrar en este entorno.</p>}
          {!session && (
            <button type="button" className="primary" onClick={signIn} disabled={isDemo || busy}>
              {busy ? 'Abriendo X…' : 'Entrar con X para ocultarme'}
            </button>
          )}
          {session && status.kind !== 'done' && (
            <div className="pv-actions">
              <button type="button" className="primary" onClick={() => hide(null)} disabled={busy}>Ocultarme</button>
              <button type="button" className="link" onClick={() => hide(true)} disabled={busy}>Ocultarme y borrar mi cuenta</button>
            </div>
          )}
          {status.kind === 'done' && <p role="status">{status.text}</p>}
          {status.kind === 'error' && <p className="au-error" role="alert">{status.text}</p>}
        </section>

        {contactEmail && (
          <>
            <h2>Contacto</h2>
            <p>Para cualquier duda o para ejercer tus derechos sin entrar con X, escribe a <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>
          </>
        )}
      </main>
    </div>
  )
}
