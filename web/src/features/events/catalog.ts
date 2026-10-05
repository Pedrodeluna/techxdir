import { useEffect, useState } from 'react'
import type { Org, TechEvent } from '../../data/sample'
import { supabase } from '../../lib/supabase'

export interface Catalog { events: TechEvent[]; orgs: Org[] }

export function useCatalog(enabled = true) {
  const [catalog, setCatalog] = useState<Catalog>({ events: [], orgs: [] })
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    async function load() {
      setLoading(true)
      setError(false)
      try {
        if (!supabase) throw new Error('No catalog configured')
        const [events, orgs] = await Promise.all([
          supabase.from('events').select('id,org_id,name,short,city,starts_on,ends_on,url,kind,color').order('starts_on').abortSignal(controller.signal),
          supabase.from('orgs').select('id,name,logo').abortSignal(controller.signal),
        ])
        if (events.error || orgs.error) throw events.error || orgs.error
        if (alive) setCatalog({
          events: events.data.map(e => ({ id: e.id, org: e.org_id, name: e.name, short: e.short, city: e.city, date: e.starts_on, end: e.ends_on, url: e.url, kind: e.kind, color: e.color })),
          orgs: orgs.data,
        })
      } catch { if (alive) setError(true) }
      finally { clearTimeout(timeout); if (alive) setLoading(false) }
    }
    void load()
    return () => { alive = false; clearTimeout(timeout); controller.abort() }
  }, [attempt, enabled])
  return { catalog, loading, error, retry: () => setAttempt(n => n + 1) }
}
