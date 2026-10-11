import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { SignOutButton } from '../lib/SignOutButton'
import { useIsAdmin } from '../lib/useIsAdmin'
import './site-header.css'

export function SiteHeader() {
  const { session } = useAuth()
  const isAdmin = useIsAdmin()
  const location = useLocation()
  const account = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (account.current && !account.current.contains(event.target as Node)) account.current.open = false
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])
  useEffect(() => { if (account.current) account.current.open = false }, [location.key])

  return <header className="site-header">
    <Link to="/" className="wordmark" aria-label="techxdir · Inicio">techx<b>dir</b></Link>
    <nav aria-label="Navegación principal">
      <Link to="/" aria-current={location.pathname === '/' && !location.hash ? 'page' : undefined}>Inicio</Link>
      <Link to="/#encuentros" aria-current={location.pathname === '/eventos' || location.hash === '#encuentros' ? 'page' : undefined}>Explorar eventos</Link>
      {session && <details ref={account} className="account-menu" onKeyDown={event => {
        if (event.key === 'Escape' && account.current?.open) {
          event.stopPropagation()
          account.current.open = false
          account.current.querySelector('summary')?.focus()
        }
      }}>
        <summary>Mi cuenta</summary>
        <div className="account-options">
          <Link to="/acreditacion">Ampliar acreditación</Link>
          <Link to="/organizaciones">Organizaciones</Link>
          {isAdmin && <Link to="/admin">Administración</Link>}
          <SignOutButton />
        </div>
      </details>}
    </nav>
  </header>
}
