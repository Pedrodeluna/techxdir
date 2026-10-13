import { useCallback, useEffect, useState } from 'react'
import { errorText } from '../../lib/dbError'
import { supabase } from '../../lib/supabase'
import { callFunction } from '../../features/sources/api'
import { formatDate, useAdmin } from './context'
import { Empty, SectionHead, SkeletonRows } from './shared'

type Run = { id: number; job: string; started_at: string; finished_at: string | null; ok: boolean | null; stats: Record<string, unknown>; error: string | null }
type Coverage = { synced_events: number; guest_total: number; with_handle: number; coverage: number | null }
type Settings = Record<'guest_ingest_enabled' | 'luma_full_list_enabled', boolean>

const JOBS: Record<string, string> = { sources: 'Fuentes', discover: 'Descubrimiento', guests: 'Asistentes', retention: 'Retención' }

function summary(stats: Record<string, unknown>) {
  return Object.entries(stats)
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => `${key} ${value}`).join(' · ')
}

export function SyncSection() {
  const { busy, run } = useAdmin()
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loadError, setLoadError] = useState('')

  const reload = useCallback(async () => {
    const client = supabase
    if (!client) return
    const [runResult, coverageResult, settingResult] = await Promise.all([
      client.from('sync_runs').select('id, job, started_at, finished_at, ok, stats, error').order('started_at', { ascending: false }).limit(30),
      client.rpc('ingest_coverage').single(),
      client.from('app_settings').select('key, value'),
    ])
    const failed = runResult.error || coverageResult.error || settingResult.error
    if (failed) throw failed
    setRuns(runResult.data as Run[])
    setCoverage(coverageResult.data as Coverage)
    setSettings(Object.fromEntries((settingResult.data ?? []).map(row => [row.key, row.value === true])) as Settings)
  }, [])

  useEffect(() => { void Promise.resolve().then(reload).catch(err => setLoadError(errorText(err))) }, [reload])

  const change = (action: () => Promise<void>, success: string) => run(async () => { await action(); await reload() }, success)
  const launch = (fn: 'sync-sources' | 'sync-guests', body: object, label: string) => void change(async () => {
    const result = await callFunction<{ errors?: string[] }>(fn, body)
    if (result.errors?.length) throw new Error(`${label}: ${result.errors[0]}`)
  }, `${label}: hecho.`)
  const toggle = (key: keyof Settings) => void change(async () => {
    const { error } = await supabase!.from('app_settings').update({ value: !settings?.[key] }).eq('key', key)
    if (error) throw error
  }, 'Ajuste guardado.')

  return (
    <>
      <SectionHead title="Sincronización" />
      {loadError && <p className="adm-error" role="alert">{loadError}</p>}

      <div className="adm-sync-grid">
        <section>
          <h2 className="adm-subhead">Lanzar ahora</h2>
          <div className="adm-actions">
            <button type="button" className="adm-pill" disabled={busy} onClick={() => launch('sync-sources', { job: 'sources', force: true }, 'Fuentes')}>Sincronizar fuentes</button>
            <button type="button" className="adm-pill adm-pill-quiet" disabled={busy} onClick={() => launch('sync-guests', {}, 'Asistentes')}>Leer asistentes</button>
            <button type="button" className="adm-pill adm-pill-quiet" disabled={busy} onClick={() => launch('sync-sources', { job: 'discover' }, 'Descubrimiento')}>Descubrir</button>
          </div>
          <p className="adm-note">Se ejecutan solas: fuentes cada día a las 06:00, asistentes cada hora y descubrimiento los lunes.</p>
        </section>

        <section>
          <h2 className="adm-subhead">Asistentes de Luma</h2>
          {coverage && (
            <p className="adm-coverage">
              <strong>{coverage.coverage === null ? '–' : `${Math.round(coverage.coverage * 100)} %`}</strong>
              <span>{coverage.with_handle} con X de {coverage.guest_total} asistentes en {coverage.synced_events} eventos</span>
            </p>
          )}
          {settings && (
            <div className="adm-switches">
              <label><input type="checkbox" checked={settings.guest_ingest_enabled} disabled={busy} onChange={() => toggle('guest_ingest_enabled')} /> Leer la muestra pública de invitados (Fase A)</label>
              <label><input type="checkbox" checked={settings.luma_full_list_enabled} disabled={busy} onChange={() => toggle('luma_full_list_enabled')} /> Lista completa con cuenta propia (Fase B, sin implementar)</label>
            </div>
          )}
        </section>
      </div>

      <h2 className="adm-subhead">Últimas ejecuciones</h2>
      {!runs ? <SkeletonRows rows={3} /> : !runs.length ? <Empty>Todavía no se ha ejecutado nada.</Empty> : (
        <ul className="adm-ledger">
          {runs.map(r => (
            <li key={r.id}>
              <div className="adm-row adm-row-static">
                <time className="adm-date" dateTime={r.started_at}>{formatDate(r.started_at)} {r.started_at.slice(11, 16)}</time>
                <span className="adm-row-main">
                  <strong>{JOBS[r.job] ?? r.job}</strong>
                  <small>{summary(r.stats) || 'sin cambios'}</small>
                  {r.error && <small className="adm-run-error">{r.error}</small>}
                </span>
                <span className={`adm-tag${r.ok === false ? ' adm-tag-ban' : ''}`}>{r.ok === null ? 'En curso' : r.ok ? 'OK' : 'Error'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
