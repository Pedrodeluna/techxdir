import { usePeople } from './usePeople'
import { useCatalog } from '../events/catalog'
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
    localStorage.setItem(key, JSON.stringify({ me: state.me, myEvents: state.myEvents }))
    return true
  } catch {
    return false
  }
}

function sample(): BadgeState {
  const saved = read(SAMPLE_KEY)
  // lo guardado antes del número de socio no lo trae
  return saved ? { ...saved, me: { memberNo: DEFAULT_ME.memberNo, ...saved.me } } : { me: { ...DEFAULT_ME }, myEvents: [...DEFAULT_MY_EVENTS] }
}

const fromProfile = (p: Profile, photo: string | null): BadgeState['me'] => ({
  name: p.name,
  handle: p.handle ?? '',
  role: p.role,
  company: p.company,
  bio: p.bio,
  photo: photo ?? p.photo_url,
  joined: p.joined,
  memberNo: p.member_no,
})

/** userId = null → acreditación de ejemplo */
export function useBadgeStore(userId: string | null) {
  const { catalog, loading: catalogLoading, error: catalogError, retry: retryCatalog } = useCatalog(Boolean(userId))
  const { people, loading: peopleLoading, error: peopleError, retry: retryPeople } = usePeople(userId)
  const key = userId ? userKey(userId) : SAMPLE_KEY
  const [state, setState] = useState<BadgeState>(() =>
    userId
      ? read(userKey(userId)) ?? { me: { ...DEFAULT_ME, name: '', handle: '', role: '', company: '', bio: '', photo: null }, myEvents: [] }
      : sample(),
  )
  const [profileError, setProfileError] = useState(false)
  const [ready, setReady] = useState(!userId)
  const latest = useRef(state)
  useEffect(() => { latest.current = state })

  const [detected, setDetected] = useState<string[]>([])

  // con sesión: el perfil y la asistencia vienen de Supabase
  useEffect(() => {
    if (!userId || !supabase) return
    const client = supabase
    let alive = true
    async function attendance() {
      // Cruza tu X verificado con los invitados de Luma. Si falla, seguimos con lo que haya.
      await client.rpc('claim_detected_attendances').then(() => undefined, () => undefined)
      const { data, error } = await client.from('attendances').select('event_id,status').eq('profile_id', userId!)
      if (error) throw error
      return data as { event_id: string; status: 'pending' | 'confirmed' | 'dismissed' }[]
    }
    Promise.all([getProfile(), attendance()]).then(([profile, rows]) => {
      if (!alive) return
      const next: BadgeState = {
        me: fromProfile(profile, latest.current.me.photo),
        myEvents: rows.filter(a => a.status === 'confirmed').map(a => a.event_id),
      }
      setState(next)
      setDetected(rows.filter(a => a.status === 'pending').map(a => a.event_id))
      write(userKey(userId), next)
      setReady(true)
    }).catch(() => { if (alive) { setProfileError(true); setReady(true) } }) // sin red: seguimos con la copia local
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
    const client = supabase
    for (const id of added) client.rpc('set_attendance', { target_event: id, going: true }).then()
    for (const id of removed) client.rpc('set_attendance', { target_event: id, going: false }).then()
    // marcar o quitar un evento detectado también lo resuelve
    if (added.length || removed.length) setDetected(list => list.filter(id => !added.includes(id) && !removed.includes(id)))
    return saved
  }, [key, userId])

  /** Confirma o descarta eventos detectados. Al confirmar, pasan a tu acreditación. */
  const reviewDetected = useCallback(async (ids: string[], accept: boolean) => {
    if (!userId || !supabase || !ids.length) return false
    const { error } = await supabase.rpc('review_detected', { event_ids: ids, accept })
    if (error) return false
    setDetected(list => list.filter(id => !ids.includes(id)))
    if (accept) {
      const next = { ...latest.current, myEvents: [...new Set([...latest.current.myEvents, ...ids])] }
      setState(next)
      write(userKey(userId), next)
    }
    return true
  }, [userId])

  const shown = userId ? { ...state, live: true, detected, reviewDetected, people, peopleLoading, peopleError, retryPeople, catalog, catalogLoading, catalogError, retryCatalog } : state
  return [shown, update, ready, profileError] as const
}
