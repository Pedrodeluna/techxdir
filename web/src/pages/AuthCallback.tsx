import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getProfile, updateProfile } from '../lib/api'
import { useAuth } from '../lib/auth-context'
import '../styles/badge.css'
import './auth.css'

/* Vuelta del enlace mágico o de X. Si falta el usuario de X (entrada por email),
   se pide aquí antes de entrar en la acreditación. */

type Step =
  | { kind: 'checking' }
  | { kind: 'complete'; name: string }
  | { kind: 'failed'; title: string; message: string }

function callbackFailure(): Extract<Step, { kind: 'failed' }> {
  const query = new URLSearchParams(location.search)
  const fragment = new URLSearchParams(location.hash.slice(1))
  if (query.has('error') || fragment.has('error')) {
    return {
      kind: 'failed',
      title: 'No hemos podido entrar',
      message: 'El proveedor de acceso ha rechazado la autenticación. Vuelve a intentarlo.',
    }
  }
  return {
    kind: 'failed',
    title: 'No hemos podido entrar',
    message: 'El enlace puede haber caducado o haberse usado ya. Pide uno nuevo o vuelve a entrar con X.',
  }
}

export function AuthCallback() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>({ kind: 'checking' })
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (loading) return
    if (!session) {
      const t = setTimeout(() => setStep(callbackFailure()), 0)
      return () => clearTimeout(t)
    }
    let alive = true
    getProfile()
      .then(p => {
        if (!alive) return
        if (p.handle) navigate('/acreditacion', { replace: true })
        else {
          setName(p.name)
          setStep({ kind: 'complete', name: p.name })
        }
      })
      .catch(() => alive && setStep({
        kind: 'failed',
        title: 'No hemos podido cargar tu acreditación',
        message: 'Tu sesión está abierta, pero ha fallado la carga del perfil. Recarga la página para intentarlo otra vez.',
      }))
    return () => { alive = false }
  }, [session, loading, navigate])

  async function save(ev: FormEvent) {
    ev.preventDefault()
    if (!name.trim() || !handle) {
      setError('Necesitamos tu nombre y tu usuario de X para la acreditación.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await updateProfile({ name: name.trim(), handle })
      navigate('/acreditacion', { replace: true })
    } catch {
      setError('Ese usuario ya está en otra acreditación, o no hemos podido guardar. Prueba con otro.')
      setSaving(false)
    }
  }

  return (
    <div className="au">
      <header className="au-top">
        <Link to="/" className="wordmark au-mark">techx<b>dir</b></Link>
      </header>
      <main className="au-stage">
        <section className="au-badge" aria-labelledby="au-title" aria-busy={step.kind === 'checking'}>
          <span className="slot" aria-hidden="true" />
          <div className="top">
            <span className="wordmark">techx<b>dir</b></span>
            <span className="tier">Attendee</span>
          </div>

          {step.kind === 'checking' && (
            <div className="au-body" role="status">
              <h1 id="au-title">Imprimiendo tu acreditación…</h1>
            </div>
          )}

          {step.kind === 'failed' && (
            <div className="au-body">
              <h1 id="au-title">{step.title}</h1>
              <p className="au-lede">{step.message}</p>
              <div className="au-foot"><Link to="/entrar" className="primary au-submit">Volver a entrar</Link></div>
            </div>
          )}

          {step.kind === 'complete' && (
            <form className="au-body" onSubmit={save} noValidate>
              <h1 id="au-title">Completa tu acreditación</h1>
              <p className="au-lede">Solo falta cómo te llamas y tu usuario de X. Lo demás lo cambias luego desde tu foto.</p>
              <label className="field">
                <span>Nombre</span>
                <input name="name" value={name} maxLength={40} autoComplete="name" onChange={ev => setName(ev.target.value)} />
              </label>
              <label className="field">
                <span>Usuario de X</span>
                <span className="prefixed">
                  <input
                    name="handle"
                    value={handle}
                    maxLength={15}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={ev => setHandle(ev.target.value.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, ''))}
                  />
                </span>
              </label>
              {error && <p className="au-error" role="alert">{error}</p>}
              <button className="primary au-submit" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Entrar en mi acreditación'}</button>
            </form>
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
