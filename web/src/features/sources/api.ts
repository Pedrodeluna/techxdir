import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

export type SourceRow = {
  id: string; org_id: string; kind: 'luma_calendar' | 'meetup_ical'; url: string; name: string
  country_filter: string | null; enabled: boolean; last_synced_at: string | null; last_error: string | null
}
export const SOURCE_COLUMNS = 'id, org_id, kind, url, name, country_filter, enabled, last_synced_at, last_error'

/** Calls an ingestion function and turns its { error } body into the thrown message. */
export async function callFunction<T>(name: 'add-url' | 'sync-sources' | 'sync-guests', body: object): Promise<T> {
  if (!supabase) throw new Error('Supabase no está configurado')
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let message = 'No se pudo completar.'
    if (error instanceof FunctionsHttpError) {
      try { message = (await error.context.json()).error ?? message } catch { /* sin cuerpo */ }
    }
    throw new Error(message)
  }
  return data as T
}

export type AddUrlInput = { url: string; org_id?: string; new_org?: string; country_filter?: 'ES' | null }
export type AddUrlResult =
  | { kind: 'source'; source: SourceRow; stats: { created: number; updated: number; errors: string[] } }
  | { kind: 'event'; event: { id: string; status: string } }

export const addUrl = (input: AddUrlInput) => callFunction<AddUrlResult>('add-url', input)
export const syncSourceNow = (sourceId: string) =>
  callFunction<{ created: number; updated: number; canceled: number; errors: string[] }>('sync-sources', { job: 'sources', source_id: sourceId })

/** "hace 3 h" para las fechas de sincronización. */
export function ago(iso: string | null): string {
  if (!iso) return 'nunca'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'ahora mismo'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `hace ${hours} h`
  return `hace ${Math.round(hours / 24)} días`
}
