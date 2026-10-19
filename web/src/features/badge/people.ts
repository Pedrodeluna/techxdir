import type { SupabaseClient } from '@supabase/supabase-js'
import type { Person } from '../../data/sample'

type PublicProfile = Pick<Person, 'id' | 'name' | 'role' | 'bio'> & { handle: string | null; photo_url: string | null }
type Attendance = { profile_id: string; event_id: string }
export type ShadowRow = {
  event_id: string; person_id: string; handle: string; name: string; avatar_url: string | null; is_me: boolean
}

// event_shadows only returns guests no account is linked to (plus your own,
// is_me), so a person never shows up both as a profile and as a shadow.
export function peopleFromRows(profiles: PublicProfile[], attendances: Attendance[], userId: string): Person[] {
  const events = new Map<string, string[]>()
  for (const row of attendances) {
    const ids = events.get(row.profile_id) ?? []
    ids.push(row.event_id)
    events.set(row.profile_id, ids)
  }
  return profiles.filter(p => p.id !== userId).map(p => ({
    ...p, avatar: p.photo_url, handle: p.handle ?? '', events: events.get(p.id) ?? [],
  }))
}

/** Invitados de Luma sin asistencia confirmada: una persona por invitado, con todos sus eventos. */
export function shadowsFromRows(rows: ShadowRow[]): Person[] {
  const byPerson = new Map<string, Person>()
  for (const row of rows) {
    if (row.is_me) continue
    const id = `x:${row.person_id}`
    const known = byPerson.get(id)
    if (known) { known.events.push(row.event_id); continue }
    byPerson.set(id, {
      id, name: row.name || `@${row.handle}`, handle: row.handle, role: '', bio: '',
      events: [row.event_id], shadow: true, avatar: row.avatar_url,
    })
  }
  return [...byPerson.values()]
}

// Page everything: PostgREST caps responses, including attendance rows.
export async function loadPeople(client: SupabaseClient, userId: string, signal: AbortSignal): Promise<Person[]> {
  const pageSize = 500
  async function profiles() {
    const rows: PublicProfile[] = []
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.from('profiles').select('id,name,handle,role,bio,photo_url')
        .neq('id', userId).order('id').range(offset, offset + pageSize - 1).abortSignal(signal)
      if (error) throw error
      rows.push(...data)
      if (data.length < pageSize) return rows
    }
  }
  async function attendances() {
    const rows: Attendance[] = []
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.from('attendances').select('profile_id,event_id')
        .neq('profile_id', userId).eq('status', 'confirmed').order('profile_id').order('event_id')
        .range(offset, offset + pageSize - 1).abortSignal(signal)
      if (error) throw error
      rows.push(...data)
      if (data.length < pageSize) return rows
    }
  }
  async function shadows() {
    const rows: ShadowRow[] = []
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.rpc('event_shadows')
        .range(offset, offset + pageSize - 1).abortSignal(signal)
      if (error) throw error
      rows.push(...(data as ShadowRow[]))
      if (data.length < pageSize) return rows
    }
  }
  const [profileRows, attendanceRows, shadowRows] = await Promise.all([profiles(), attendances(), shadows()])
  return [...peopleFromRows(profileRows, attendanceRows, userId), ...shadowsFromRows(shadowRows)]
}
