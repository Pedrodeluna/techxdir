import { useEffect, useState } from 'react'
import { useAuth } from './auth-context'
import { supabase } from './supabase'

/** True when the signed-in person has the app admin role. */
export function useIsAdmin(): boolean {
  const { session } = useAuth()
  const [admin, setAdmin] = useState(false)
  useEffect(() => {
    if (!supabase || !session) return
    let alive = true
    supabase.rpc('is_app_admin').then(({ data }) => { if (alive) setAdmin(Boolean(data)) })
    return () => { alive = false }
  }, [session])
  return Boolean(session) && admin
}
