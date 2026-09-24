import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { errorText } from '../../lib/dbError'
import { supabase } from '../../lib/supabase'
import { SectionHead, SkeletonRows } from './shared'
import { formatDate, useAdmin } from './context'

type AdminRow = { profile_id: string; created_at: string; name: string; handle: string | null }

export function AdminsSection() {
  const { me, busy, run } = useAdmin()
  const [admins, setAdmins] = useState<AdminRow[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [handle, setHandle] = useState('')
  const navigate = useNavigate()

  const reload = useCallback(async () => {
    const client = supabase
    if (!client) return
    const { data, error } = await client.from('app_admins').select('profile_id, created_at').order('created_at')
    if (error) throw error
    const ids = (data ?? []).map(row => row.profile_id)
    const profiles = ids.length ? await client.from('profiles').select('id, name, handle').in('id', ids) : { data: [], error: null }
    if (profiles.error) throw profiles.error
    const byId = new Map((profiles.data ?? []).map(profile => [profile.id, profile]))
    setAdmins((data ?? []).map(row => ({ ...row, name: byId.get(row.profile_id)?.name ?? '', handle: byId.get(row.profile_id)?.handle ?? null })))
  }, [])

  useEffect(() => { void Promise.resolve().then(reload).catch(err => setLoadError(errorText(err))) }, [reload])

  const add = async (event: FormEvent) => {
    event.preventDefault()
    const ok = await run(async () => {
      const { error } = await supabase!.rpc('grant_admin', { admin_handle: handle.trim() })
      if (error) throw error
      await reload()
    }, 'Administrador añadido.')
    if (ok) setHandle('')
  }

  const only = (admins?.length ?? 0) < 2

  return (
    <>
      <SectionHead title="Administradores" count={admins?.length} />
      <p className="adm-lede">Un administrador crea y elimina organizaciones, gestiona todos los eventos y bloquea usuarios.</p>

      <form className="adm-inline-form adm-grant" onSubmit={event => void add(event)}>
        <label className="adm-field"><span>Añadir administrador</span>
          <input required value={handle} onChange={event => setHandle(event.target.value)} placeholder="@usuario" spellCheck={false} />
        </label>
        <button className="adm-pill" disabled={busy}>Dar rol</button>
      </form>

      {loadError && <p className="adm-error" role="alert">{loadError}</p>}
      {!admins ? <SkeletonRows rows={3} /> : (
        <ul className="adm-ledger">
          {admins.map(admin => (
            <li key={admin.profile_id}>
              <div className="adm-row adm-row-static">
                <span className="adm-row-main">
                  <strong>{admin.name || 'Sin nombre'}{admin.profile_id === me && <span className="adm-you"> · tú</span>}</strong>
                  <small className="adm-mono">{admin.handle ? `@${admin.handle}` : 'sin usuario'}</small>
                </span>
                <span className="adm-row-meta">desde {formatDate(admin.created_at)}</span>
                <span className="adm-row-action">
                  <button type="button" className="adm-pill adm-pill-quiet" disabled={busy || only}
                    title={only ? 'Debe quedar al menos un administrador' : undefined}
                    onClick={() => void run(async () => {
                      const { error } = await supabase!.rpc('revoke_admin', { target: admin.profile_id })
                      if (error) throw error
                      if (admin.profile_id === me) navigate('/acreditacion', { replace: true })
                      else await reload()
                    }, admin.profile_id === me ? 'Ya no eres administrador.' : 'Rol retirado.')}>
                    {admin.profile_id === me ? 'Dejar el rol' : 'Quitar rol'}
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
