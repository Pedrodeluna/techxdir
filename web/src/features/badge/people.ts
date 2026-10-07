import type { SupabaseClient } from '@supabase/supabase-js'
import type { Person } from '../../data/sample'

type PublicProfile = Pick<Person, 'id' | 'name' | 'role' | 'bio'> & { handle: string | null }
type Attendance = { profile_id: string; event_id: string }

export function peopleFromRows(profiles: PublicProfile[], attendances: Attendance[], userId: string): Person[] {
  const events = new Map<string, string[]>()
  for (const row of attendances) {
    const ids = events.get(row.profile_id) ?? []
    ids.push(row.event_id)
    events.set(row.profile_id, ids)
  }
  return profiles.filter(p => p.id !== userId).map(p => ({
    ...p, handle: p.handle ?? '', events: events.get(p.id) ?? [],
  }))
}

// Page both tables: PostgREST caps responses, including attendance rows.
export async function loadPeople(client: SupabaseClient, userId: string, signal: AbortSignal): Promise<Person[]> {
  const pageSize = 500
  async function profiles() {
    const rows: PublicProfile[] = []
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.from('profiles').select('id,name,handle,role,bio')
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
        .neq('profile_id', userId).order('profile_id').order('event_id')
        .range(offset, offset + pageSize - 1).abortSignal(signal)
      if (error) throw error
      rows.push(...data)
      if (data.length < pageSize) return rows
    }
  }
  const [profileRows, attendanceRows] = await Promise.all([profiles(), attendances()])
  return peopleFromRows(profileRows, attendanceRows, userId)
}
