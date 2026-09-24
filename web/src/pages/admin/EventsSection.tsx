import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { errorText } from '../../lib/dbError'
import { supabase } from '../../lib/supabase'
import { DangerZone, Empty, SectionHead, SkeletonRows } from './shared'
import { formatDate, slugify, slugPattern, useAdmin, type AdminEvent, type Org } from './context'

type When = 'upcoming' | 'past' | 'all'
const COLUMNS = 'id, org_id, name, short, city, starts_on, ends_on, url, kind, color'
const whenLabels: Record<When, string> = { upcoming: 'Próximos', past: 'Pasados', all: 'Todos' }

export function EventsSection() {
  const { busy, run } = useAdmin()
  const [events, setEvents] = useState<AdminEvent[] | null>(null)
  const [orgs, setOrgs] = useState<Org[]>([])
  const [attendance, setAttendance] = useState<Record<string, number>>({})
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [orgFilter, setOrgFilter] = useState('')
  const [when, setWhen] = useState<When>('upcoming')
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = useCallback(async () => {
    const client = supabase
    if (!client) return
    const [eventResult, orgResult, attendanceResult] = await Promise.all([
      client.from('events').select(COLUMNS).order('starts_on'),
      client.from('orgs').select('id, name, logo').order('name'),
      client.from('attendances').select('event_id'),
    ])
    const failed = eventResult.error || orgResult.error || attendanceResult.error
    if (failed) throw failed
    setEvents(eventResult.data ?? [])
    setOrgs(orgResult.data ?? [])
    const counts: Record<string, number> = {}
    for (const row of attendanceResult.data ?? []) counts[row.event_id] = (counts[row.event_id] ?? 0) + 1
    setAttendance(counts)
  }, [])

  useEffect(() => { void Promise.resolve().then(reload).catch(err => setLoadError(errorText(err))) }, [reload])

  const orgName = useMemo(() => new Map(orgs.map(org => [org.id, org.name])), [orgs])
  const visible = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const q = query.trim().toLowerCase()
    const rows = (events ?? []).filter(event =>
      (!orgFilter || event.org_id === orgFilter)
      && (when === 'all' || (when === 'upcoming' ? (event.ends_on ?? event.starts_on) >= today : (event.ends_on ?? event.starts_on) < today))
      && (!q || [event.name, event.short, event.city, event.id].some(value => value.toLowerCase().includes(q))))
    return when === 'past' ? rows.reverse() : rows
  }, [events, orgFilter, when, query])

  const change = (action: () => Promise<void>, success: string) => run(async () => { await action(); await reload() }, success)

  return (
    <>
      <SectionHead
        title="Eventos"
        count={events?.length}
        action={!creating && <button type="button" className="adm-pill" disabled={!orgs.length} onClick={() => { setCreating(true); setOpenId(null) }}>Nuevo evento</button>}
      />
      {creating && (
        <EventForm orgs={orgs} busy={busy} onCancel={() => setCreating(false)} onSave={row => change(async () => {
          const { error } = await supabase!.from('events').insert(row)
          if (error) throw error
          setCreating(false)
        }, 'Evento creado.')} />
      )}

      <div className="adm-filters">
        <label className="adm-search">
          <span className="sr-only">Buscar eventos</span>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nombre o ciudad" />
        </label>
        <label className="adm-select">
          <span className="sr-only">Organización</span>
          <select value={orgFilter} onChange={event => setOrgFilter(event.target.value)}>
            <option value="">Todas las organizaciones</option>
            {orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
        </label>
        <div className="adm-segmented" role="group" aria-label="Fechas">
          {(Object.keys(whenLabels) as When[]).map(value => (
            <button key={value} type="button" aria-pressed={when === value} onClick={() => setWhen(value)}>{whenLabels[value]}</button>
          ))}
        </div>
      </div>

      {loadError && <p className="adm-error" role="alert">{loadError}</p>}
      {!events ? <SkeletonRows /> : !visible.length ? (
        <Empty>{events.length ? 'Ningún evento coincide con estos filtros.' : 'Aún no hay eventos. Crea el primero desde “Nuevo evento”.'}</Empty>
      ) : (
        <ul className="adm-ledger">
          {visible.map(event => {
            const open = openId === event.id
            const people = attendance[event.id] ?? 0
            return (
              <li key={event.id} className={open ? 'is-open' : undefined}>
                <button type="button" className="adm-row" aria-expanded={open} onClick={() => setOpenId(open ? null : event.id)}>
                  <time className="adm-date" dateTime={event.starts_on}>{formatDate(event.starts_on)}</time>
                  <span className="adm-row-main"><strong>{event.name}</strong><small>{orgName.get(event.org_id) ?? event.org_id} · {event.city}</small></span>
                  <span className="adm-row-meta">{people} {people === 1 ? 'asistente' : 'asistentes'}</span>
                  <span className="adm-row-cue" aria-hidden="true">{open ? 'Cerrar' : 'Editar'}</span>
                </button>
                {open && (
                  <div className="adm-editor">
                    <EventForm key={event.id} event={event} orgs={orgs} busy={busy} onSave={row => change(async () => {
                      const { id: _id, org_id: _org, ...patch } = row
                      const { data, error } = await supabase!.from('events').update(patch).eq('id', event.id).select('id').single()
                      if (error) throw error
                      if (!data) throw new Error('No se pudo actualizar el evento.')
                    }, 'Evento actualizado.')} />
                    <DangerZone
                      id={event.id}
                      label="Eliminar evento"
                      consequence={`Se borran el evento y ${people} ${people === 1 ? 'asistencia' : 'asistencias'}. No se puede deshacer.`}
                      onConfirm={() => void change(async () => {
                        const { data, error } = await supabase!.from('events').delete().eq('id', event.id).select('id').single()
                        if (error) throw error
                        if (!data) throw new Error('No se pudo eliminar el evento.')
                        setOpenId(null)
                      }, 'Evento eliminado.')}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function EventForm({ event, orgs, busy, onSave, onCancel }: {
  event?: AdminEvent; orgs: Org[]; busy: boolean; onSave: (row: AdminEvent) => void; onCancel?: () => void
}) {
  const creating = !event
  const [draft, setDraft] = useState<AdminEvent>(event ?? {
    id: '', org_id: orgs[0]?.id ?? '', name: '', short: '', city: '', starts_on: '', ends_on: null, url: null, kind: '', color: '#111113',
  })
  const [idTouched, setIdTouched] = useState(false)
  const [problem, setProblem] = useState('')
  const set = (changes: Partial<AdminEvent>) => setDraft(previous => ({ ...previous, ...changes }))

  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault()
    const url = draft.url?.trim() || null
    if (url && !/^https?:\/\//.test(url)) { setProblem('La web debe empezar por https://.'); return }
    if (draft.ends_on && draft.ends_on < draft.starts_on) { setProblem('La fecha de fin no puede ser anterior a la de inicio.'); return }
    setProblem('')
    onSave({
      ...draft, id: draft.id.trim(), name: draft.name.trim(), short: draft.short.trim() || draft.name.trim(),
      city: draft.city.trim(), kind: draft.kind.trim(), url, ends_on: draft.ends_on || null,
    })
  }

  return (
    <form className={`adm-form${creating ? ' adm-create' : ''}`} onSubmit={submit}>
      {creating && <h2>Nuevo evento</h2>}
      <label className="adm-field adm-span-2"><span>Nombre</span>
        <input required autoFocus={creating} maxLength={100} value={draft.name} placeholder="Commit Conf 2027"
          onChange={e => set({ name: e.target.value, ...(creating && !idTouched ? { id: slugify(e.target.value) } : {}) })} />
      </label>
      <label className="adm-field"><span>Nombre corto</span>
        <input maxLength={30} value={draft.short} onChange={e => set({ short: e.target.value })} placeholder="Commit Conf" />
        <small>Se ve en la acreditación.</small>
      </label>
      <label className="adm-field"><span>Organización</span>
        <select required disabled={!creating} value={draft.org_id} onChange={e => set({ org_id: e.target.value })}>
          {orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
        </select>
      </label>
      {creating && (
        <label className="adm-field"><span>Identificador</span>
          <input required maxLength={48} pattern={slugPattern} value={draft.id} spellCheck={false} placeholder="commit-27"
            onChange={e => { setIdTouched(true); set({ id: e.target.value.toLowerCase() }) }} />
          <small>No se puede cambiar después.</small>
        </label>
      )}
      <label className="adm-field"><span>Ciudad</span>
        <input required maxLength={60} value={draft.city} onChange={e => set({ city: e.target.value })} placeholder="Madrid" />
      </label>
      <label className="adm-field"><span>Tipo</span>
        <input required maxLength={30} value={draft.kind} onChange={e => set({ kind: e.target.value })} placeholder="Conferencia" list="adm-kinds" />
        <datalist id="adm-kinds">{['Conferencia', 'Hackathon', 'Comunidad', 'Meetup', 'Taller'].map(kind => <option key={kind} value={kind} />)}</datalist>
      </label>
      <label className="adm-field"><span>Inicio</span>
        <input required type="date" value={draft.starts_on} onChange={e => set({ starts_on: e.target.value })} />
      </label>
      <label className="adm-field"><span>Fin</span>
        <input type="date" min={draft.starts_on || undefined} value={draft.ends_on ?? ''} onChange={e => set({ ends_on: e.target.value || null })} />
        <small>Vacío si dura un día.</small>
      </label>
      <label className="adm-field adm-span-2"><span>Web</span>
        <input type="url" value={draft.url ?? ''} onChange={e => set({ url: e.target.value })} placeholder="https://…" aria-invalid={Boolean(problem) || undefined} />
      </label>
      <label className="adm-field adm-color"><span>Color</span>
        <input type="color" value={draft.color} onChange={e => set({ color: e.target.value })} />
        <code>{draft.color}</code>
      </label>
      {problem && <p className="adm-inline-error adm-span-all" role="alert">{problem}</p>}
      <div className="adm-actions adm-span-all">
        <button className="adm-pill" disabled={busy}>{creating ? 'Crear evento' : 'Guardar cambios'}</button>
        {onCancel && <button type="button" className="adm-link" onClick={onCancel}>Cancelar</button>}
      </div>
    </form>
  )
}
