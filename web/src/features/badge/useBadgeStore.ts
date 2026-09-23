import { useCallback, useEffect, useRef, useState } from 'react'
import { updateProfile, getProfile, type Profile } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { DEFAULT_ME, DEFAULT_MY_EVENTS, type BadgeState } from './model'

/* Estado de la acreditación.
   - Ejemplo (sin sesión): datos de ejemplo guardados en este navegador.
   - Con sesión: el perfil viene de la función `profile` y la asistencia de la
     tabla `attendances`. La foto se queda en este navegador por ahora. */

const SAMPLE_KEY = 'techxdir:acreditacion:v1' // la clave del prototipo: conserva lo que ya tenías
const userKey = (id: string) => `techxdir:acreditacion:v1:${id}`

function read(key: string): BadgeState | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (saved && saved.me && Array.isArray(saved.myEvents)) return saved
  } catch { /* sin almacenamiento */ }
  return null
}

function write(key: string, state: BadgeState) {
  try {
    localStorage.setItem(key, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

const sample = (): BadgeState => read(SAMPLE_KEY) ?? { me: { ...DEFAULT_ME }, myEvents: [...DEFAULT_MY_EVENTS] }

const fromProfile = (p: Profile, photo: string | null): BadgeState['me'] => ({
  name: p.name,
  handle: p.handle ?? '',
  role: p.role,
  company: p.company,
  bio: p.bio,
  photo: photo ?? p.photo_url,
  joined: p.joined,
})

/** userId = null → acreditación de ejemplo */
export function useBadgeStore(userId: string | null) {
  const key = userId ? userKey(userId) : SAMPLE_KEY
  const [state, setState] = useState<BadgeState>(() =>
    userId
      ? read(userKey(userId)) ?? { me: { ...DEFAULT_ME, name: '', handle: '', role: '', company: '', bio: '', photo: null }, myEvents: [] }
      : sample(),
  )
  const [ready, setReady] = useState(!userId)
  const latest = useRef(state)
  useEffect(() => { latest.current = state })

  // con sesión: el perfil y la asistencia vienen de Supabase
  useEffect(() => {
    if (!userId || !supabase) return
    let alive = true
    Promise.all([
      getProfile(),
      supabase.from('attendances').select('event_id').eq('profile_id', userId),
    ]).then(([profile, attendance]) => {
      if (!alive) return
      const next: BadgeState = {
        me: fromProfile(profile, latest.current.me.photo),
        myEvents: attendance.data?.map(a => a.event_id as string) ?? latest.current.myEvents,
      }
      setState(next)
      write(userKey(userId), next)
      setReady(true)
    }).catch(() => alive && setReady(true)) // sin red: seguimos con la copia local
    return () => { alive = false }
  }, [userId])

  /** Aplica el cambio, lo guarda y, con sesión, lo sincroniza. Devuelve false si no se pudo guardar. */
  const update = useCallback((next: BadgeState) => {
    const prev = latest.current
    setState(next)
    const saved = write(key, next)
    if (!userId || !supabase) return saved

    const { me } = next
    if (me !== prev.me) {
      updateProfile({ name: me.name, role: me.role, company: me.company, bio: me.bio })
        .catch(() => { /* la copia local sigue; se reintenta en el próximo cambio */ })
    }
    const added = next.myEvents.filter(id => !prev.myEvents.includes(id))
    const removed = prev.myEvents.filter(id => !next.myEvents.includes(id))
    if (added.length) supabase.from('attendances').insert(added.map(event_id => ({ profile_id: userId, event_id }))).then()
    if (removed.length) supabase.from('attendances').delete().eq('profile_id', userId).in('event_id', removed).then()
    return saved
  }, [key, userId])

  const shown = userId ? { ...state, live: true } : state
  return [shown, update, ready] as const
}
