// sync-sources: imports events from the curated sources, or runs the weekly discovery.
//
//   POST /functions/v1/sync-sources  { job?: 'sources' | 'discover', source_id?: string, force?: boolean }
//
// Called by pg_cron (x-cron-secret), by admins, and by managers for the
// sources of their organizations ("Sincronizar ahora").
import { authorize, canManage, serviceClient } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { deadlineFrom, discover, finishRun, startRun, syncAll, useSharedLumaPace } from '../_shared/ingest.ts'

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  const deadline = deadlineFrom()

  const db = serviceClient()
  const caller = await authorize(req, db)
  if (!caller) return json({ error: 'Not allowed' }, 403)

  let body: { job?: string; source_id?: string; force?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    // an empty body runs the default job
  }
  const job = body.job === 'discover' ? 'discover' : 'sources'

  if (job === 'discover' && caller.kind === 'manager') return json({ error: 'Only admins run the discovery' }, 403)
  if (job === 'sources' && caller.kind === 'manager') {
    if (!body.source_id) return json({ error: 'Pick a source' }, 400)
    const { data: src } = await db.from('event_sources').select('org_id').eq('id', body.source_id).maybeSingle()
    if (!src || !canManage(caller, src.org_id)) return json({ error: 'Not allowed' }, 403)
  }

  useSharedLumaPace(db)
  const run = await startRun(db, job)
  try {
    const stats = job === 'discover'
      ? await discover(db, deadline)
      : await syncAll(db, { sourceId: body.source_id, force: body.force === true, deadline })
    await finishRun(db, run, stats)
    return json(stats)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishRun(db, run, {}, message)
    return json({ error: message }, 500)
  }
})
