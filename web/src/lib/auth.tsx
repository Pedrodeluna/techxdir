import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { AuthContext, useAuth, type AuthState } from './auth-context'
import { isDemo, supabase } from './supabase'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: !isDemo })

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, loading: false }))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ session, loading: false }))
    return () => data.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

/** Private routes. In demo mode (no Supabase env) everyone gets in with sample data. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (isDemo) return children
  if (loading) return null
  if (!session) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
  return children
}
