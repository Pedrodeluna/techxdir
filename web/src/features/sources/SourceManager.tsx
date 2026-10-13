import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { addUrl, ago, SOURCE_COLUMNS, syncSourceNow, type SourceRow } from './api'
import './sources.css'

type OrgOption = { id: string; name: string }

/* Fuentes de eventos: añadir por URL, activar o pausar, sincronizar y quitar. */
export function SourceManager({ orgs, orgId, admin, busy, run }: {
  orgs: OrgOption[]
  /** Solo las fuentes de esta organización (página de organizaciones) */
  orgId?: string
  admin: boolean
  busy: boolean
  run: (action: () => Promise<void>, success: string) => Promise<unknown>
}) {
  const [sources, setSources] = useState<SourceRow[] | null>(null)
  const [url, setUrl] = useState('')
  const [target, setTarget] = useState(orgId ?? orgs[0]?.id ?? '')
  const [onlySpain, setOnlySpain] = useState(false)

  const reload = useCallback(async () => {
    if (!supabase) return
    let query = supabase.from('event_sources').select(SOURCE_COLUMNS).order('created_at', { ascending: false })
    if (orgId) query = query.eq('org_id', orgId)
    const { data, error } = await query
    if (error) throw error
    setSources(data as SourceRow[])
  }, [orgId])

  useEffect(() => { void Promise.resolve().then(reload).catch(() => setSources([])) }, [reload])

  const orgName = new Map(orgs.map(org => [org.id, org.name]))
  const change = (action: () => Promise<void>, success: string) => run(async () => { await action(); await reload() }, success)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = url.trim()
    if (!value || !target) return
    void change(async () => {
      const result = await addUrl({ url: value, org_id: target, country_filter: onlySpain ? 'ES' : null })
      setUrl('')
      if (result.kind === 'source' && result.stats.errors.length) throw new Error(`Fuente añadida, pero la primera lectura falló: ${result.stats.errors[0]}`)
    }, 'Añadido. Lo importado ya está en Eventos; un evento suelto entra como borrador.')
  }

  return (
    <div className="src">
      <form className="src-add" onSubmit={submit}>
        <label className="src-url">
          <span>Añadir por URL</span>
          <input type="url" required value={url} onChange={event => setUrl(event.target.value)}
            placeholder="https://luma.com/tu-calendario · https://www.meetup.com/tu-grupo" />
        </label>
        {!orgId && (
          <label className="src-org">
            <span>Organización</span>
            <select value={target} onChange={event => setTarget(event.target.value)}>
              {orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
          </label>
        )}
        <label className="src-check">
          <input type="checkbox" checked={onlySpain} onChange={event => setOnlySpain(event.target.checked)} />
          <span>Solo eventos en España</span>
        </label>
        <button className="src-pill" disabled={busy || !url.trim()}>Añadir</button>
        <small className="src-help">Un calendario de Luma o un grupo de Meetup se sincroniza cada día. Un evento suelto de Luma entra como borrador{admin ? '' : ' para que lo revises'}.</small>
      </form>

      {!sources ? <p className="src-empty" aria-busy="true">Cargando fuentes…</p> : !sources.length ? (
        <p className="src-empty">Aún no hay fuentes. Pega el enlace del calendario de Luma o del grupo de Meetup.</p>
      ) : (
        <ul className="src-list">
          {sources.map(src => (
            <li key={src.id} className={src.enabled ? undefined : 'is-off'}>
              <div className="src-main">
                <span className="src-kind">{src.kind === 'luma_calendar' ? 'Luma' : 'Meetup'}</span>
                <a href={src.url} target="_blank" rel="noopener noreferrer"><strong>{src.name || src.url}</strong></a>
                <small>
                  {!orgId && <>{orgName.get(src.org_id) ?? src.org_id} · </>}
                  {src.country_filter ? `solo ${src.country_filter} · ` : ''}
                  sincronizada {ago(src.last_synced_at)}
                </small>
                {src.last_error && <small className="src-error" role="note">Último error: {src.last_error}</small>}
              </div>
              <div className="src-actions">
                <button type="button" className="src-link" disabled={busy || !src.enabled}
                  onClick={() => void change(async () => {
                    const stats = await syncSourceNow(src.id)
                    if (stats.errors.length) throw new Error(stats.errors[0])
                  }, 'Sincronizada.')}>Sincronizar ahora</button>
                <button type="button" className="src-link" disabled={busy}
                  onClick={() => void change(async () => {
                    const { error } = await supabase!.from('event_sources').update({ enabled: !src.enabled }).eq('id', src.id)
                    if (error) throw error
                  }, src.enabled ? 'Fuente pausada.' : 'Fuente activada.')}>{src.enabled ? 'Pausar' : 'Activar'}</button>
                <button type="button" className="src-link src-danger" disabled={busy}
                  onClick={() => void change(async () => {
                    const { error } = await supabase!.from('event_sources').delete().eq('id', src.id)
                    if (error) throw error
                  }, 'Fuente quitada. Sus eventos se quedan.')}>Quitar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
