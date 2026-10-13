// add-url: "Añadir por URL". A Luma calendar or a Meetup group becomes a
// source and is read at once. A single Luma event is imported as a draft.
//
//   POST /functions/v1/add-url
//   { url: string, org_id?: string, new_org?: string, country_filter?: 'ES' | null }
//
// Admins can add to any organization and create one (new_org); managers
// only add to the organizations they run.
import { authorize, canManage, serviceClient, userIdOf } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { deadlineFrom, emptyStats, fromLuma, eventIdBase, meetupGroup, meetupIcalUrl, shortName, slugify,
  type Source, syncSource, useSharedLumaPace } from '../_shared/ingest.ts'
import { lumaSlug, resolve } from '../_shared/luma.ts'

type Body = { url?: unknown; org_id?: unknown; new_org?: unknown; country_filter?: unknown }

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const db = serviceClient()
  const caller = await authorize(req, db)
  if (!caller || caller.kind === 'cron') return json({ error: 'Not allowed' }, 403)
  const deadline = deadlineFrom()
  useSharedLumaPace(db)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be valid JSON' }, 400)
  }
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url || url.length > 300) return json({ error: 'Pega un enlace de Luma o Meetup' }, 400)
  const countryFilter = body.country_filter === 'ES' ? 'ES' : null
  const newOrg = typeof body.new_org === 'string' ? body.new_org.trim().slice(0, 80) : ''
  let orgId = typeof body.org_id === 'string' ? body.org_id : ''
  if (!newOrg && !orgId) return json({ error: 'Elige una organización' }, 400)
  if (newOrg && caller.kind !== 'admin') return json({ error: 'Solo un admin crea organizaciones' }, 403)
  if (orgId && !canManage(caller, orgId)) return json({ error: 'No gestionas esa organización' }, 403)

  // What is behind the link?
  let source: Omit<Source, 'id' | 'org_id'> & { name: string }
  const group = meetupGroup(url)
  const slug = group ? null : lumaSlug(url)
  if (group) {
    const res = await fetch(meetupIcalUrl(group), { signal: AbortSignal.timeout(15_000) })
    await res.body?.cancel()
    if (!res.ok) return json({ error: 'No encontramos ese grupo de Meetup' }, 404)
    source = { kind: 'meetup_ical', url: `https://www.meetup.com/${group}/`, external_id: group,
      name: group, country_filter: countryFilter }
  } else if (slug) {
    const found = await resolve(slug)
    if (!found) return json({ error: 'No encontramos ese enlace en Luma' }, 404)
    if (found.kind === 'event') {
      if (!orgId) return json({ error: 'Elige una organización para el evento' }, 400)
      const payload = fromLuma(found.data)
      const { data, error } = await db.rpc('ingest_event', {
        payload: { ...payload, source_id: null, org_id: orgId,
          id_base: eventIdBase(payload.name, payload.starts_at), short: shortName(payload.name) },
      })
      if (error) return json({ error: error.message }, 500)
      if (data?.reason === 'other_org') {
        return json({ error: 'Ese evento ya está en otra organización', event: data }, 409)
      }
      await db.from('import_suggestions').update({ status: 'accepted' }).eq('external_id', payload.external_id)
      return json({ kind: 'event', event: data })
    }
    const cal = found.data.calendar
    source = { kind: 'luma_calendar', url: `https://luma.com/${cal.slug ?? slug}`, external_id: cal.api_id,
      name: cal.name, country_filter: countryFilter }
  } else {
    return json({ error: 'Solo admitimos enlaces de luma.com y meetup.com' }, 400)
  }

  const { data: existing } = await db.from('event_sources').select('id, org_id')
    .eq('kind', source.kind).eq('external_id', source.external_id).maybeSingle()
  if (existing) return json({ error: 'Esa fuente ya está añadida', source_id: existing.id }, 409)

  if (newOrg) {
    const base = slugify(newOrg).slice(0, 40) || 'org'
    let id = base
    for (let n = 2; ; n++) {
      const { data } = await db.from('orgs').select('id').eq('id', id).maybeSingle()
      if (!data) break
      id = `${base}-${n}`
    }
    const { error } = await db.from('orgs').insert({ id, name: newOrg })
    if (error) return json({ error: error.message }, 500)
    orgId = id
  }

  const { data: created, error } = await db.from('event_sources')
    .insert({ ...source, org_id: orgId, created_by: userIdOf(caller) })
    .select('id, org_id, kind, url, external_id, country_filter, name')
    .single()
  if (error) return json({ error: error.message }, 500)
  await db.from('import_suggestions').update({ status: 'accepted' }).eq('external_id', source.external_id)

  const stats = emptyStats()
  await syncSource(db, created as Source, stats, deadline)
  return json({ kind: 'source', source: created, org_id: orgId, stats }, 201)
})
