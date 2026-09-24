import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useNotify } from '../features/badge/Toast'
import { useAuth } from '../lib/auth-context'
import { errorText } from '../lib/dbError'
import { SignOutButton } from '../lib/SignOutButton'
import { isDemo, supabase } from '../lib/supabase'
import { AdminContext, type AdminContextValue, type Counts } from './admin/context'
import '../styles/badge.css'
import './admin/admin.css'

type Access = 'loading' | 'admin' | 'denied' | 'demo' | 'error'

async function loadCounts(): Promise<Counts> {
  if (!supabase) throw new Error('Supabase is not configured')
  const count = (table: string) => supabase!.from(table).select('*', { count: 'exact', head: true })
  const [people, orgs, events, bans, admins] = await Promise.all([
    count('profiles'), count('orgs'), count('events'), count('bans'), count('app_admins'),
  ])
  const failed = [people, orgs, events, bans, admins].find(result => result.error)
  if (failed?.error) throw failed.error
  return { people: people.count ?? 0, orgs: orgs.count ?? 0, events: events.count ?? 0, bans: bans.count ?? 0, admins: admins.count ?? 0 }
}

const sections: { to: string; label: string; count?: (c: Counts) => number; note?: (c: Counts) => string | null }[] = [
  { to: '/admin', label: 'Resumen' },
  { to: '/admin/organizaciones', label: 'Organizaciones', count: c => c.orgs },
  { to: '/admin/eventos', label: 'Eventos', count: c => c.events },
  { to: '/admin/usuarios', label: 'Usuarios', count: c => c.people, note: c => c.bans ? `${c.bans} ${c.bans === 1 ? 'bloqueado' : 'bloqueados'}` : null },
  { to: '/admin/administradores', label: 'Administradores', count: c => c.admins },
]

export function Admin() {
  const { session } = useAuth()
  const notify = useNotify()
  const [access, setAccess] = useState<Access>(isDemo ? 'demo' : 'loading')
  const [counts, setCounts] = useState<Counts | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    document.title = 'techxdir · Administración'
    if (!supabase || !session) return
    let alive = true
    void (async () => {
      const { data, error: rpcError } = await supabase!.rpc('is_app_admin')
      if (!alive) return
      if (rpcError) { setAccess('error'); return }
      if (!data) { setAccess('denied'); return }
      setAccess('admin')
      try { setCounts(await loadCounts()) } catch (err) { if (alive) setError(errorText(err)) }
    })()
    return () => { alive = false }
  }, [session])

  const run = useCallback(async (action: () => Promise<void>, success: string) => {
    setBusy(true)
    setError('')
    try {
      await action()
      setCounts(await loadCounts())
      notify(success)
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    } finally {
      setBusy(false)
    }
  }, [notify])

  const value = useMemo<AdminContextValue>(() => ({
    me: session?.user.id ?? '', counts, busy, run, error, clearError: () => setError(''),
  }), [session, counts, busy, run, error])

  return (
    <div className="adm">
      <header className="adm-top">
        <Link to="/acreditacion" className="wordmark">techx<b>dir</b></Link>
        <span className="adm-top-label">Administración</span>
        <nav className="adm-top-actions" aria-label="Cuenta">
          <Link to="/acreditacion" className="adm-link">Mi acreditación</Link>
          {session && <SignOutButton />}
        </nav>
      </header>

      {access === 'loading' && <main className="adm-gate" aria-busy="true" />}
      {access === 'demo' && <main className="adm-gate"><h1>Sin conexión</h1><p>Conecta Supabase para usar la administración.</p></main>}
      {access === 'error' && (
        <main className="adm-gate">
          <h1>No se pudo comprobar tu acceso</h1>
          <p>Revisa la conexión y vuelve a cargar la página.</p>
          <button type="button" className="adm-pill" onClick={() => window.location.reload()}>Volver a cargar</button>
        </main>
      )}
      {access === 'denied' && (
        <main className="adm-gate">
          <h1>Solo para administradores</h1>
          <p>Tu cuenta no tiene el rol de administrador. Si gestionas una organización, la editas desde su página.</p>
          <Link to="/organizaciones" className="adm-pill">Ir a organizaciones</Link>
        </main>
      )}

      {access === 'admin' && (
        <AdminContext.Provider value={value}>
          <div className="adm-body">
            <nav className="adm-index" aria-label="Secciones">
              <ul>
                {sections.map(section => (
                  <li key={section.to}>
                    <NavLink to={section.to} end>
                      <span className="adm-index-label">{section.label}</span>
                      {section.count && <span className="adm-index-count">{counts ? section.count(counts) : '–'}</span>}
                      {section.note && counts && section.note(counts) && <span className="adm-index-note">{section.note(counts)}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            <main className="adm-sheet">
              {error && (
                <div className="adm-error" role="alert">
                  <p>{error}</p>
                  <button type="button" className="adm-link" onClick={() => setError('')}>Cerrar</button>
                </div>
              )}
              <Outlet />
            </main>
          </div>
        </AdminContext.Provider>
      )}
    </div>
  )
}
