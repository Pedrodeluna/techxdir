import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { OrgShape } from '../../data/sample'
import { errorText } from '../../lib/dbError'
import { supabase } from '../../lib/supabase'
import { DangerZone, Empty, OrgMark, SectionHead, SkeletonRows } from './shared'
import { slugify, slugPattern, useAdmin, type Org } from './context'

type Manager = { org_id: string; profile_id: string; handle: string | null; name: string }
const shapes: OrgShape[] = ['circle', 'square', 'squircle', 'hex', 'diamond', 'ring']
const shapeNames: Record<OrgShape, string> = { circle: 'Círculo', square: 'Cuadrado', squircle: 'Redondeado', hex: 'Hexágono', diamond: 'Rombo', ring: 'Anillo' }

export function OrgsSection() {
  const { busy, run } = useAdmin()
  const [orgs, setOrgs] = useState<Org[] | null>(null)
  const [managers, setManagers] = useState<Manager[]>([])
  const [eventCounts, setEventCounts] = useState<Record<string, number>>({})
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = useCallback(async () => {
    const client = supabase
    if (!client) return
    const [orgResult, managerResult, eventResult] = await Promise.all([
      client.from('orgs').select('id, name, logo').order('name'),
      client.from('org_managers').select('org_id, profile_id'),
      client.from('events').select('org_id'),
    ])
    const failed = orgResult.error || managerResult.error || eventResult.error
    if (failed) throw failed
    const ids = [...new Set((managerResult.data ?? []).map(row => row.profile_id))]
    const profiles = ids.length ? await client.from('profiles').select('id, handle, name').in('id', ids) : { data: [], error: null }
    if (profiles.error) throw profiles.error
    const byId = new Map((profiles.data ?? []).map(profile => [profile.id, profile]))
    setOrgs(orgResult.data ?? [])
    setManagers((managerResult.data ?? []).map(row => ({ ...row, handle: byId.get(row.profile_id)?.handle ?? null, name: byId.get(row.profile_id)?.name ?? '' })))
    const countMap: Record<string, number> = {}
    for (const event of eventResult.data ?? []) countMap[event.org_id] = (countMap[event.org_id] ?? 0) + 1
    setEventCounts(countMap)
  }, [])

  useEffect(() => { void Promise.resolve().then(reload).catch(err => setLoadError(errorText(err))) }, [reload])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (orgs ?? []).filter(org => !q || org.name.toLowerCase().includes(q) || org.id.includes(q))
  }, [orgs, query])

  const change = (action: () => Promise<void>, success: string) => run(async () => { await action(); await reload() }, success)

  return (
    <>
      <SectionHead
        title="Organizaciones"
        count={orgs?.length}
        action={!creating && <button type="button" className="adm-pill" onClick={() => { setCreating(true); setOpenId(null) }}>Nueva organización</button>}
      />
      {creating && <CreateOrg busy={busy} onCancel={() => setCreating(false)} onCreate={(id, name, manager) => change(async () => {
        const client = supabase!
        const { error } = await client.rpc('create_org', { org_id: id, org_name: name, manager_handle: manager })
        if (error) throw error
        setCreating(false)
      }, 'Organización creada.')} />}

      <label className="adm-search">
        <span className="sr-only">Buscar organizaciones</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nombre o identificador" />
      </label>

      {loadError && <p className="adm-error" role="alert">{loadError}</p>}
      {!orgs ? <SkeletonRows /> : !visible.length ? (
        <Empty>{orgs.length ? 'Ninguna organización coincide con la búsqueda.' : 'Aún no hay organizaciones. Crea la primera y asígnale un gestor.'}</Empty>
      ) : (
        <ul className="adm-ledger">
          {visible.map(org => {
            const people = managers.filter(manager => manager.org_id === org.id)
            const events = eventCounts[org.id] ?? 0
            const open = openId === org.id
            return (
              <li key={org.id} className={open ? 'is-open' : undefined}>
                <button type="button" className="adm-row" aria-expanded={open} onClick={() => setOpenId(open ? null : org.id)}>
                  <OrgMark org={org} />
                  <span className="adm-row-main"><strong>{org.name}</strong><small className="adm-mono">/{org.id}</small></span>
                  <span className="adm-row-meta">{events} {events === 1 ? 'evento' : 'eventos'} · {people.length} {people.length === 1 ? 'gestor' : 'gestores'}</span>
                  <span className="adm-row-cue" aria-hidden="true">{open ? 'Cerrar' : 'Editar'}</span>
                </button>
                {open && (
                  <div className="adm-editor">
                    <OrgForm key={org.id} org={org} busy={busy} onSave={(name, logo) => change(async () => {
                      const { data, error } = await supabase!.from('orgs').update({ name, logo }).eq('id', org.id).select('id').single()
                      if (error) throw error
                      if (!data) throw new Error('No se pudo actualizar la organización.')
                    }, 'Organización actualizada.')} />
                    <Managers
                      people={people}
                      busy={busy}
                      onAdd={handle => change(async () => {
                        const { error } = await supabase!.rpc('add_org_manager', { org: org.id, manager_handle: handle })
                        if (error) throw error
                      }, 'Gestor añadido.')}
                      onRemove={profileId => change(async () => {
                        const { error } = await supabase!.from('org_managers').delete().eq('org_id', org.id).eq('profile_id', profileId)
                        if (error) throw error
                      }, 'Gestor retirado.')}
                    />
                    <DangerZone
                      id={org.id}
                      label="Eliminar organización"
                      consequence={`Se borran la organización, sus ${events} ${events === 1 ? 'evento' : 'eventos'}, las asistencias a esos eventos y sus gestores. No se puede deshacer.`}
                      onConfirm={() => void change(async () => {
                        const { data, error } = await supabase!.from('orgs').delete().eq('id', org.id).select('id').single()
                        if (error) throw error
                        if (!data) throw new Error('No se pudo eliminar la organización.')
                        setOpenId(null)
                      }, 'Organización eliminada.')}
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

function CreateOrg({ busy, onCancel, onCreate }: { busy: boolean; onCancel: () => void; onCreate: (id: string, name: string, manager: string) => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [manager, setManager] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onCreate(slug.trim(), name.trim(), manager.trim())
  }
  return (
    <form className="adm-form adm-create" onSubmit={submit}>
      <h2>Nueva organización</h2>
      <label className="adm-field"><span>Nombre</span>
        <input required autoFocus minLength={2} maxLength={100} value={name} placeholder="Nombre público"
          onChange={event => { setName(event.target.value); if (!slugTouched) setSlug(slugify(event.target.value)) }} />
      </label>
      <label className="adm-field"><span>Identificador</span>
        <input required maxLength={48} pattern={slugPattern} value={slug} placeholder="mi-organizacion" spellCheck={false}
          onChange={event => { setSlugTouched(true); setSlug(event.target.value.toLowerCase()) }} />
        <small>No se puede cambiar después.</small>
      </label>
      <label className="adm-field"><span>Primer gestor</span>
        <input required value={manager} onChange={event => setManager(event.target.value)} placeholder="@usuario" spellCheck={false} />
        <small>Debe tener cuenta en techxdir.</small>
      </label>
      <div className="adm-actions">
        <button className="adm-pill" disabled={busy}>Crear organización</button>
        <button type="button" className="adm-link" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  )
}

function OrgForm({ org, busy, onSave }: { org: Org; busy: boolean; onSave: (name: string, logo: Org['logo']) => void }) {
  const [name, setName] = useState(org.name)
  const [mark, setMark] = useState(typeof org.logo === 'string' ? '' : org.logo?.mark ?? '')
  const [shape, setShape] = useState<OrgShape>(typeof org.logo === 'string' ? 'circle' : org.logo?.shape ?? 'circle')
  const [imageUrl, setImageUrl] = useState(typeof org.logo === 'string' ? org.logo : '')
  const [problem, setProblem] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const url = imageUrl.trim()
    if (url && !url.startsWith('https://')) { setProblem('La URL del logotipo debe empezar por https://.'); return }
    if ([...mark.trim()].length > 3) { setProblem('El monograma admite hasta 3 caracteres.'); return }
    setProblem('')
    onSave(name.trim(), url || { mark: mark.trim(), shape })
  }

  return (
    <form className="adm-form" onSubmit={submit}>
      <div className="adm-preview">
        <OrgMark org={{ name, logo: imageUrl.trim() || { mark, shape } }} />
      </div>
      <label className="adm-field adm-span-2"><span>Nombre público</span>
        <input required minLength={2} maxLength={100} value={name} onChange={event => setName(event.target.value)} />
      </label>
      <label className="adm-field"><span>Monograma</span>
        <input maxLength={3} value={mark} onChange={event => setMark(event.target.value)} placeholder="Iniciales" />
      </label>
      <label className="adm-field"><span>Forma</span>
        <select value={shape} onChange={event => setShape(event.target.value as OrgShape)}>
          {shapes.map(value => <option key={value} value={value}>{shapeNames[value]}</option>)}
        </select>
      </label>
      <label className="adm-field adm-span-2"><span>URL del logotipo</span>
        <input type="url" value={imageUrl} onChange={event => setImageUrl(event.target.value)} placeholder="https://…" aria-invalid={Boolean(problem) || undefined} />
        <small>Opcional. Si la indicas, sustituye al monograma.</small>
      </label>
      {problem && <p className="adm-inline-error adm-span-all" role="alert">{problem}</p>}
      <div className="adm-actions adm-span-all"><button className="adm-pill" disabled={busy}>Guardar cambios</button></div>
    </form>
  )
}

function Managers({ people, busy, onAdd, onRemove }: {
  people: Manager[]; busy: boolean; onAdd: (handle: string) => Promise<boolean>; onRemove: (profileId: string) => void
}) {
  const [handle, setHandle] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await onAdd(handle.trim())) setHandle('')
  }
  return (
    <div className="adm-group">
      <h3>Gestores</h3>
      <ul className="adm-chips">
        {people.map(person => (
          <li key={person.profile_id}>
            <span className="adm-mono">{person.handle ? `@${person.handle}` : person.name || 'Sin usuario'}</span>
            <button type="button" className="adm-link" disabled={busy || people.length < 2}
              title={people.length < 2 ? 'Debe quedar al menos un gestor' : undefined}
              onClick={() => onRemove(person.profile_id)}>Quitar</button>
          </li>
        ))}
        {!people.length && <li className="adm-muted">Sin gestores</li>}
      </ul>
      <form className="adm-inline-form" onSubmit={event => void submit(event)}>
        <label className="adm-field"><span>Añadir gestor</span>
          <input required value={handle} onChange={event => setHandle(event.target.value)} placeholder="@usuario" spellCheck={false} />
        </label>
        <button className="adm-pill adm-pill-quiet" disabled={busy}>Añadir</button>
      </form>
    </div>
  )
}
