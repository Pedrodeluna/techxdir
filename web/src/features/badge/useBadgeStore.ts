import { useCallback, useState } from 'react'
import { DEFAULT_ME, DEFAULT_MY_EVENTS, type BadgeState } from './model'

/* Persistencia local. Con Supabase configurado, este hook será el punto que
   lea y escriba el perfil a través de la función `profile`. */

const STORE_KEY = 'techxdir:acreditacion:v1'

function load(): BadgeState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')
    if (saved && saved.me && Array.isArray(saved.myEvents)) return saved
  } catch { /* sin almacenamiento: usamos los datos de ejemplo */ }
  return { me: { ...DEFAULT_ME }, myEvents: [...DEFAULT_MY_EVENTS] }
}

function save(state: BadgeState) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function useBadgeStore() {
  const [state, setState] = useState(load)

  /** Aplica el cambio y lo guarda. Devuelve false si no se pudo guardar. */
  const update = useCallback((next: BadgeState) => {
    setState(next)
    return save(next)
  }, [])

  return [state, update] as const
}
