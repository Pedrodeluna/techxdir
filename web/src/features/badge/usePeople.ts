import { useEffect, useState } from 'react'
import type { Person } from '../../data/sample'
import { supabase } from '../../lib/supabase'
import { loadPeople } from './people'

export function usePeople(userId: string | null) {
  const [result, setResult] = useState<{ userId: string | null; attempt: number; people: Person[]; loading: boolean; error: boolean }>({
    userId: null, attempt: -1, people: [], loading: false, error: false,
  })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!userId) return
    let alive = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    async function load() {
      try {
        if (!supabase) throw new Error('Supabase is not configured')
        const people = await loadPeople(supabase, userId!, controller.signal)
        if (alive) setResult({ userId, attempt, people, loading: false, error: false })
      } catch {
        if (alive) setResult({ userId, attempt, people: [], loading: false, error: true })
      } finally { clearTimeout(timeout) }
    }
    void load()
    return () => { alive = false; clearTimeout(timeout); controller.abort() }
  }, [userId, attempt])
  // Never show a previous account's results while the next request starts.
  const current = userId && result.userId === userId && result.attempt === attempt ? result : { people: [], loading: Boolean(userId), error: false }
  return { ...current, retry: () => setAttempt(n => n + 1) }
}
