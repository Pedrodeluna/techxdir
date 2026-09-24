import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { SignOutButton } from '../lib/SignOutButton'
import { errorText } from '../lib/dbError'
import { isDemo, supabase } from '../lib/supabase'
import type { OrgShape } from '../data/sample'
import './organizations.css'

type Org = { id: string; name: string; logo: { mark?: string; shape?: OrgShape } | string }
type OrgDraft = { name: string; mark: string; shape: OrgShape; imageUrl: string }
type Manager = { org_id: string; profile_id: string; handle: string | null; name: string }
const shapes: OrgShape[] = ['circle', 'square', 'squircle', 'hex', 'diamond', 'ring']

function draftFor(org: Org): OrgDraft {
  return {
    name: org.name,
    mark: typeof org.logo === 'string' ? '' : org.logo?.mark ?? '',
    shape: typeof org.logo === 'string' ? 'circle' : org.logo?.shape ?? 'circle',
    imageUrl: typeof org.logo === 'string' ? org.logo : '',
  }
}

export function Organizations() {
  const { session } = useAuth()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [managers, setManagers] = useState<Manager[]>([])
  const [admin, setAdmin] = useState(false)
  const [loading, setLoading] = useState(!isDemo)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [addHandles, setAddHandles] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, OrgDraft>>({})

  const reload = useCallback(async () => {
    if (!supabase || !session) return
    const [orgResult, managerResult, adminResult] = await Promise.all([
      supabase.from('orgs').select('id, name, logo').order('name'),
      supabase.from('org_managers').select('org_id, profile_id'),
      supabase.rpc('is_app_admin'),
    ])
    if (orgResult.error || managerResult.error || adminResult.error) {
      throw orgResult.error || managerResult.error || adminResult.error
    }
    const rows = managerResult.data ?? []
    const ids = [...new Set(rows.map(row => row.profile_id))]
    const profileResult = ids.length
      ? await supabase.from('profiles').select('id, handle, name').in('id', ids)
      : { data: [], error: null }
    if (profileResult.error) throw profileResult.error
    const profiles = new Map((profileResult.data ?? []).map(profile => [profile.id, profile]))
    setOrgs(orgResult.data ?? [])
    setManagers(rows.map(row => ({
      ...row,
      handle: profiles.get(row.profile_id)?.handle ?? null,
      name: profiles.get(row.profile_id)?.name ?? '',
    })))
    setAdmin(Boolean(adminResult.data))
    setLoading(false)
  }, [session])

  useEffect(() => {
    document.title = 'techxdir · Organizaciones'
    if (!isDemo) void Promise.resolve().then(reload).catch(err => { setError(errorText(err)); setLoading(false) })
  }, [reload])

  const change = async (action: () => Promise<void>, success: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      await reload()
      setNotice(success)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const addManager = (event: FormEvent, orgId: string) => {
    event.preventDefault()
    const client = supabase
    if (!client) return
    void change(async () => {
      const handle = addHandles[orgId]?.trim().replace(/^@/, '')
      if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('Introduce un usuario válido de X.')
      const { error: insertError } = await client.rpc('add_org_manager', { org: orgId, manager_handle: handle })
      if (insertError) throw insertError
      setAddHandles(previous => ({ ...previous, [orgId]: '' }))
    }, 'Gestor añadido.')
  }

  const editDraft = (org: Org, changes: Partial<OrgDraft>) => {
    setDrafts(previous => ({ ...previous, [org.id]: { ...previous[org.id] ?? draftFor(org), ...changes } }))
  }

  const saveOrg = (event: FormEvent, org: Org) => {
    event.preventDefault()
    const client = supabase
    if (!client) return
    void change(async () => {
      const draft = drafts[org.id] ?? draftFor(org)
      const next = draft.name.trim()
      if (next.length < 2 || next.length > 100) throw new Error('El nombre debe tener entre 2 y 100 caracteres.')
      const imageUrl = draft.imageUrl.trim()
      if (imageUrl) {
        let url: URL
        try { url = new URL(imageUrl) } catch { throw new Error('Introduce una URL de imagen válida.') }
        if (url.protocol !== 'https:') throw new Error('La URL del logotipo debe empezar por https://.')
      }
      const mark = draft.mark.trim()
      if ([...mark].length > 3) throw new Error('El monograma admite hasta 3 caracteres.')
      const logo = imageUrl || { mark, shape: draft.shape }
      const { data, error: updateError } = await client.from('orgs').update({ name: next, logo }).eq('id', org.id).select('id').single()
      if (updateError) throw updateError
      if (!data) throw new Error('No se pudo actualizar la organización.')
      setDrafts(previous => { const nextDrafts = { ...previous }; delete nextDrafts[org.id]; return nextDrafts })
    }, 'Organización actualizada.')
  }

  const removeManager = (orgId: string, profileId: string) => {
    const client = supabase
    if (!client) return
    void change(async () => {
      const { error: deleteError } = await client.from('org_managers').delete()
        .eq('org_id', orgId).eq('profile_id', profileId)
      if (deleteError) throw deleteError
    }, 'Gestor retirado.')
  }

  return (
    <main className="organizations">
      <header className="org-top">
        <Link to="/acreditacion" className="wordmark">techx<b>dir</b></Link>
        <nav className="org-top-actions" aria-label="Cuenta">
          <Link to="/acreditacion" className="org-back">← Mi acreditación</Link>
          {session && <SignOutButton />}
        </nav>
      </header>
      <div className="org-layout">
        <div className="org-intro">
          <span className="org-kicker">Directorio / 01</span>
          <h1>Organizaciones<span className="org-dot">.</span></h1>
          <p>Los equipos que hacen posibles los eventos. Cada organización tiene sus propios gestores.</p>
        </div>

        {error && <p className="org-message org-error" role="alert">{error}</p>}
        {notice && <p className="org-message" role="status">{notice}</p>}
        {isDemo && <p className="org-message">Conecta Supabase para ver y gestionar las organizaciones.</p>}
        {admin && <p className="org-message">Eres administrador. Crea y elimina organizaciones desde <Link to="/admin/organizaciones">Administración</Link>.</p>}

        <section className="org-directory" aria-labelledby="directory-title">
          <div className="org-section-head"><span>01 / Directorio</span><h2 id="directory-title">Todas las organizaciones <em>{orgs.length}</em></h2></div>
          {loading && <p className="org-empty">Cargando organizaciones…</p>}
          {!loading && !orgs.length && <p className="org-empty">Aún no hay organizaciones.</p>}
          {orgs.map(org => {
            const people = managers.filter(manager => manager.org_id === org.id)
            const canEdit = people.some(manager => manager.profile_id === session?.user.id)
            return (
              <article className="org-row" key={org.id}>
                <div className="org-row-main"><span className="org-mark">{typeof org.logo === 'string' ? <img src={org.logo} alt="" /> : org.logo?.mark || org.name.slice(0, 2).toUpperCase()}</span><div><h3>{org.name}</h3><span className="org-id">/{org.id}</span></div><span className="org-count">{people.length} {people.length === 1 ? 'gestor' : 'gestores'}</span></div>
                {canEdit && <div className="org-controls">
                  <form className="org-edit-form" onSubmit={event => saveOrg(event, org)}>
                    <h4>Editar organización</h4>
                    <label>Nombre público<input required minLength={2} maxLength={100} value={(drafts[org.id] ?? draftFor(org)).name} onChange={event => editDraft(org, { name: event.target.value })} /></label>
                    <label>Monograma<input maxLength={3} value={(drafts[org.id] ?? draftFor(org)).mark} onChange={event => editDraft(org, { mark: event.target.value })} placeholder="Iniciales" /></label>
                    <label>Forma<select value={(drafts[org.id] ?? draftFor(org)).shape} onChange={event => editDraft(org, { shape: event.target.value as OrgShape })}>{shapes.map(shape => <option key={shape} value={shape}>{shape}</option>)}</select></label>
                    <label className="org-image-field">URL del logotipo <small>Opcional; si se indica, sustituye al monograma.</small><input type="url" value={(drafts[org.id] ?? draftFor(org)).imageUrl} onChange={event => editDraft(org, { imageUrl: event.target.value })} placeholder="https://…" /></label>
                    <button disabled={busy}>Guardar cambios</button>
                  </form>
                  <div className="org-manager-list"><span>Gestores</span>{people.map(person => <div key={person.profile_id}><span>{person.handle ? `@${person.handle}` : person.name || 'Sin usuario'}</span><button disabled={busy || people.length < 2} title={people.length < 2 ? 'Debe quedar al menos un gestor' : undefined} onClick={() => removeManager(org.id, person.profile_id)}>Quitar</button></div>)}</div>
                  <form onSubmit={event => addManager(event, org.id)}><label>Añadir gestor<input required value={addHandles[org.id] ?? ''} onChange={event => setAddHandles(previous => ({ ...previous, [org.id]: event.target.value }))} placeholder="@usuario" /></label><button disabled={busy}>Añadir</button></form>
                </div>}
              </article>
            )
          })}
        </section>
      </div>
    </main>
  )
}
