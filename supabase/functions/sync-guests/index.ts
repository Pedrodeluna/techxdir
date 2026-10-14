// sync-guests: reads the public guest sample (hosts and featured guests) of
// upcoming Luma events and matches it to verified X handles.
//
//   POST /functions/v1/sync-guests  { event_id?: string }
//
// Called every hour by pg_cron and by admins. An event is read again after
// 6 hours, and one last time a day after it ends; then it is frozen.
import { authorize, serviceClient } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { deadlineFrom, finishRun, fromLuma, startRun, useSharedLumaPace } from '../_shared/ingest.ts'
import { guestsOf, LumaError, resolve } from '../_shared/luma.ts'

const HOUR = 3600_000

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  const deadline = deadlineFrom()

  const db = serviceClient()
  const caller = await authorize(req, db)
  if (!caller || caller.kind === 'manager') return json({ error: 'Not allowed' }, 403)

  let body: { event_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    // no body: every event that is due
  }

  const { data: settings } = await db.from('app_settings').select('key, value')
  const setting = (key: string) => settings?.find(s => s.key === key)?.value === true
  if (!setting('guest_ingest_enabled')) return json({ skipped: 'guest_ingest_enabled is off' })

  useSharedLumaPace(db)
  const run = await startRun(db, 'guests')
  const stats = { events: 0, stored: 0, linked: 0, frozen: 0, pending: 0, errors: [] as string[], notes: [] as string[] }
  if (setting('luma_full_list_enabled')) stats.notes.push('Phase B (full guest list) is not implemented; ran Phase A')

  try {
    let query = db.from('events')
      .select('id, url, starts_at, ends_at, guests_synced_at')
      .eq('external_kind', 'luma').eq('status', 'published').eq('guests_frozen', false)
      .lte('starts_at', new Date(Date.now() + 60 * 24 * HOUR).toISOString())
      .order('guests_synced_at', { ascending: true, nullsFirst: true })
      .limit(500)
    if (body.event_id) query = query.eq('id', body.event_id)
    const { data: events, error } = await query
    if (error) throw new Error(error.message)

    const now = Date.now()
    const due = (events ?? []).filter(e => {
      if (body.event_id || !e.guests_synced_at) return true
      const synced = new Date(e.guests_synced_at).getTime()
      const ended = new Date(e.ends_at ?? e.starts_at).getTime()
      if (now > ended + 24 * HOUR) return synced < ended + 24 * HOUR
      return now - synced > 6 * HOUR
    })

    for (const [i, event] of due.entries()) {
      if (Date.now() > deadline) {
        stats.pending = due.length - i
        break
      }
      const ended = new Date(event.ends_at ?? event.starts_at).getTime()
      const last = Date.now() > ended + 24 * HOUR
      try {
        const slug = String(event.url ?? '').split('/').pop()!
        const found = await resolve(slug)
        if (found?.kind !== 'event') {
          stats.errors.push(`${event.id}: not found on Luma`)
          continue
        }
        const { data, error } = await db.rpc('ingest_guests', {
          target_event: event.id,
          guests: guestsOf(found.data),
          total: fromLuma(found.data).guest_count,
          full_list: false,
        })
        if (error) throw new Error(error.message)
        stats.events++
        stats.stored += data.stored
        stats.linked += data.linked
        if (last) {
          await db.from('events').update({ guests_frozen: true }).eq('id', event.id)
          stats.frozen++
        }
      } catch (error) {
        if (!(error instanceof LumaError) && !(error instanceof Error)) throw error
        stats.errors.push(`${event.id}: ${error.message}`)
      }
    }
    await finishRun(db, run, stats)
    return json(stats)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishRun(db, run, stats, message)
    return json({ error: message }, 500)
  }
})
