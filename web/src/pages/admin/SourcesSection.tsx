import { useCallback, useEffect, useState } from 'react'
import { errorText } from '../../lib/dbError'
import { supabase } from '../../lib/supabase'
import { addUrl } from '../../features/sources/api'
import { SourceManager } from '../../features/sources/SourceManager'
import { formatDate, useAdmin, type Org } from './context'
import { Empty, SectionHead } from './shared'

type Suggestion = {
  id: string; kind: 'luma_calendar' | 'luma_event'; external_id: string; url: string; name: string
  city: string | null; starts_on: string | null; found_via: string
}

export function SourcesSection() {
  const { busy, run } = useAdmin()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState('')

  const reload = useCallback(async () => {
    const client = supabase
    if (!client) return
    const [orgResult, suggestionResult] = await Promise.all([
      client.from('orgs').select('id, name, logo').order('name'),
      client.from('import_suggestions').select('id, kind, external_id, url, name, city, starts_on, found_via')
        .eq('status', 'pending').order('created_at', { ascending: false }).limit(100),
    ])
    const failed = orgResult.error || suggestionResult.error
    if (failed) throw failed
    setOrgs(orgResult.data ?? [])
    setSuggestions(suggestionResult.data ?? [])
  }, [])

  useEffect(() => { void Promise.resolve().then(reload).catch(err => setLoadError(errorText(err))) }, [reload])

  const change = (action: () => Promise<void>, success: string) => run(async () => { await action(); await reload() }, success)
  // '' = crear una organización con el nombre del calendario
  const targetOf = (s: Suggestion) => targets[s.id] ?? (s.kind === 'luma_calendar' ? '' : orgs[0]?.id ?? '')

  return (
    <>
      <SectionHead title="Fuentes" />
      {loadError && <p className="adm-error" role="alert">{loadError}</p>}
      {orgs.length > 0 && <SourceManager orgs={orgs} admin busy={busy} run={change} />}

      <h2 className="adm-subhead">Sugerencias del descubrimiento</h2>
      <p className="adm-note">Calendarios y eventos de Luma en Madrid y Barcelona que aún no seguimos. Nada se importa hasta que lo aceptas.</p>
      {!suggestions ? null : !suggestions.length ? <Empty>No hay sugerencias pendientes.</Empty> : (
        <ul className="adm-ledger">
          {suggestions.map(s => (
            <li key={s.id}>
              <div className="adm-row adm-row-static">
                <span className="adm-date">{s.kind === 'luma_calendar' ? 'Calendario' : s.starts_on ? formatDate(s.starts_on) : 'Evento'}</span>
                <span className="adm-row-main">
                  <strong><a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a></strong>
                  <small>{s.city ?? 'Sin ciudad'} · {s.found_via.replace('discover:', 'visto en ')}</small>
                </span>
                <span className="adm-suggest-actions">
                  <select aria-label="Organización" value={targetOf(s)} onChange={event => setTargets(t => ({ ...t, [s.id]: event.target.value }))}>
                    {s.kind === 'luma_calendar' && <option value="">Nueva: {s.name}</option>}
                    {orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
                  </select>
                  <button type="button" className="adm-pill adm-pill-quiet" disabled={busy}
                    onClick={() => void change(async () => {
                      const org = targetOf(s)
                      await addUrl(org ? { url: s.url, org_id: org } : { url: s.url, new_org: s.name })
                    }, s.kind === 'luma_calendar' ? 'Calendario añadido como fuente.' : 'Evento importado como borrador.')}>Aceptar</button>
                  <button type="button" className="adm-link" disabled={busy}
                    onClick={() => void change(async () => {
                      const { error } = await supabase!.from('import_suggestions').update({ status: 'dismissed' }).eq('id', s.id)
                      if (error) throw error
                    }, 'Sugerencia descartada.')}>Descartar</button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
