import { createContext, useContext } from 'react'
import type { OrgShape } from '../../data/sample'

export type OrgLogo = { mark?: string; shape?: OrgShape } | string
export type Org = { id: string; name: string; logo: OrgLogo }
export type AdminEvent = {
  id: string; org_id: string; name: string; short: string; city: string
  starts_on: string; ends_on: string | null; url: string | null; kind: string; color: string
  status?: 'draft' | 'published' | 'canceled' | 'merged'
  external_kind?: 'luma' | 'meetup' | null
  duplicate_of?: string | null
  guest_count?: number | null
}
export type Person = { id: string; name: string; handle: string | null; member_no: number; created_at: string }
export type Counts = { people: number; orgs: number; events: number; bans: number; admins: number; review: number; suggestions: number }

/** Lo que se puede editar a mano de un evento (las columnas con grant update). */
export const editableEvent = ({ name, short, city, starts_on, ends_on, url, kind, color }: AdminEvent) =>
  ({ name, short, city, starts_on, ends_on, url, kind, color })

export interface AdminContextValue {
  me: string
  counts: Counts | null
  busy: boolean
  /** Runs a change, reloads the counts, and shows a toast. Returns false on error. */
  run: (action: () => Promise<void>, success: string) => Promise<boolean>
  error: string
  clearError: () => void
}

export const AdminContext = createContext<AdminContextValue | null>(null)
export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext)
  if (!value) throw new Error('useAdmin needs AdminContext')
  return value
}

export const slugPattern = '[a-z0-9]+(-[a-z0-9]+)*'
export const slugify = (text: string) => text
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)

/** PostgREST `or` filters use commas and parentheses as syntax, and `ilike` treats % and _ as wildcards. */
export const searchTerm = (text: string) => text.trim().replace(/[%_,()\\*]/g, ' ').replace(/\s+/g, ' ').trim()

const dateFormat = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
export const formatDate = (iso: string) => dateFormat.format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)).replace('.', '')
