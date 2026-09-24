import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { errorText } from '../../lib/dbError'
import { supabase } from '../../lib/supabase'
import { Empty, SectionHead, SkeletonRows } from './shared'
import { formatDate, searchTerm, useAdmin, type Person } from './context'

type Ban = { profile_id: string; reason: string; created_at: string }
type Filter = 'all' | 'banned'
const PAGE = 40
const COLUMNS = 'id, name, handle, member_no, created_at'

export function UsersSection() {
  const { me, busy, run, counts } = useAdmin()
  const [people, setPeople] = useState<Person[] | null>(null)
  const [more, setMore] = useState(false)
  const [bans, setBans] = useState<Map<string, Ban>>(new Map())
  const [admins, setAdmins] = useState<Set<string>>(new Set())
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [banning, setBanning] = useState<string | null>(null)

  const load = useCallback(async (term: string, which: Filter, offset: number) => {
    const client = supabase
    if (!client) return
    const [banResult, adminResult] = await Promise.all([
      client.from('bans').select('profile_id, reason, created_at'),
      client.from('app_admins').select('profile_id'),
    ])
    if (banResult.error || adminResult.error) throw banResult.error || adminResult.error
    const banMap = new Map((banResult.data ?? []).map(ban => [ban.profile_id, ban]))
    let request = client.from('profiles').select(COLUMNS).order('member_no', { ascending: false }).range(offset, offset + PAGE)
    const clean = searchTerm(term).replace(/^@/, '')
    if (clean) request = request.or(`name.ilike.*${clean}*,handle.ilike.*${clean}*`)
    if (which === 'banned') request = request.in('id', banMap.size ? [...banMap.keys()] : ['00000000-0000-0000-0000-000000000000'])
    const { data, error } = await request
    if (error) throw error
    const rows = data ?? []
    setBans(banMap)
    setAdmins(new Set((adminResult.data ?? []).map(row => row.profile_id)))
    setMore(rows.length > PAGE)
    setPeople(previous => [...(offset && previous ? previous : []), ...rows.slice(0, PAGE)])
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoadError('')
      load(query, filter, 0).catch(err => setLoadError(errorText(err)))
    }, query ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, query, filter])

  const reloadFirstPage = () => load(query, filter, 0)

  return (
    <>
      <SectionHead title="Usuarios" count={counts?.people} />
      <div className="adm-filters">
        <label className="adm-search">
          <span className="sr-only">Buscar usuarios</span>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nombre o @usuario" spellCheck={false} />
        </label>
        <div className="adm-segmented" role="group" aria-label="Estado">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todos</button>
          <button type="button" aria-pressed={filter === 'banned'} onClick={() => setFilter('banned')}>Bloqueados{counts?.bans ? ` · ${counts.bans}` : ''}</button>
        </div>
      </div>

      {loadError && <p className="adm-error" role="alert">{loadError}</p>}
      {!people ? <SkeletonRows /> : !people.length ? (
        <Empty>{filter === 'banned' ? 'No hay nadie bloqueado.' : query ? 'Nadie coincide con la búsqueda.' : 'Nadie se ha registrado todavía.'}</Empty>
      ) : (
        <ul className="adm-ledger">
          {people.map(person => {
            const ban = bans.get(person.id)
            const isAdmin = admins.has(person.id)
            const isMe = person.id === me
            return (
              <li key={person.id} className={banning === person.id ? 'is-open' : undefined}>
                <div className={`adm-row adm-row-static${ban ? ' is-banned' : ''}`}>
                  <span className="adm-no adm-mono">{String(person.member_no).padStart(4, '0')}</span>
                  <span className="adm-row-main">
                    <strong>{person.name || 'Sin nombre'}</strong>
                    <small className="adm-mono">{person.handle ? `@${person.handle}` : 'sin usuario'} · alta {formatDate(person.created_at)}</small>
                  </span>
                  <span className="adm-tags">
                    {isAdmin && <span className="adm-tag">Admin</span>}
                    {ban && <span className="adm-tag adm-tag-ban" title={ban.reason || undefined}>Bloqueado</span>}
                  </span>
                  <span className="adm-row-action">
                    {ban ? (
                      <button type="button" className="adm-pill adm-pill-quiet" disabled={busy} onClick={() => void run(async () => {
                        const { error } = await supabase!.rpc('unban_user', { target: person.id })
                        if (error) throw error
                        await reloadFirstPage()
                      }, 'Usuario desbloqueado.')}>Desbloquear</button>
                    ) : !isAdmin && !isMe && banning !== person.id && (
                      <button type="button" className="adm-pill adm-pill-quiet" onClick={() => setBanning(person.id)}>Bloquear</button>
                    )}
                  </span>
                </div>
                {ban?.reason && <p className="adm-ban-reason">Motivo: {ban.reason}</p>}
                {banning === person.id && (
                  <BanForm
                    person={person}
                    busy={busy}
                    onCancel={() => setBanning(null)}
                    onBan={reason => void run(async () => {
                      const { error } = await supabase!.rpc('ban_user', { target: person.id, ban_reason: reason })
                      if (error) throw error
                      setBanning(null)
                      await reloadFirstPage()
                    }, 'Usuario bloqueado.')}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
      {more && people && (
        <button type="button" className="adm-more adm-pill adm-pill-quiet" onClick={() => load(query, filter, people.length).catch(err => setLoadError(errorText(err)))}>
          Cargar más
        </button>
      )}
    </>
  )
}

function BanForm({ person, busy, onBan, onCancel }: { person: Person; busy: boolean; onBan: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); onBan(reason.trim()) }
  return (
    <form className="adm-danger adm-ban" onSubmit={submit}>
      <p>{person.name || 'Esta persona'} no podrá iniciar sesión y se cerrarán sus sesiones abiertas. Su acreditación sigue siendo pública.</p>
      <label className="adm-field">
        <span>Motivo</span>
        <input autoFocus maxLength={200} value={reason} onChange={event => setReason(event.target.value)} placeholder="Solo lo ven los administradores" />
      </label>
      <div className="adm-actions">
        <button className="adm-pill adm-pill-danger" disabled={busy}>Bloquear</button>
        <button type="button" className="adm-link" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  )
}
