import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabase'

export function SignOutButton() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function signOut() {
    if (!supabase || busy) return
    setBusy(true)
    setError(false)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      navigate('/', { replace: true })
    } catch {
      setError(true)
      setBusy(false)
    }
  }

  return (
    <div className="sign-out">
      <button type="button" onClick={signOut} disabled={busy}>
        {busy ? 'Desconectando…' : 'Desconectarse'}
      </button>
      {error && <span role="alert">No se pudo cerrar la sesión. Inténtalo de nuevo.</span>}
    </div>
  )
}
