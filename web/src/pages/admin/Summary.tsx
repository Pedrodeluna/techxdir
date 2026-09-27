import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { errorText } from '../../lib/dbError'
import { supabase } from '../../lib/supabase'
import { Empty, SectionHead, SkeletonRows } from './shared'
import { formatDate, type AdminEvent, type Person } from './context'

type Recent = { events: AdminEvent[]; people: Person[]; bans: { profile_id: string; reason: string; created_at: string; person?: Person }[] }

export function Summary() {
  const [data, setData] = useState<Recent | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const client = supabase
    if (!client) return
    let alive = true
    void (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10)
        const [events, people, bans] = await Promise.all([
          client.from('events').select('id, org_id, name, short, city, starts_on, ends_on, url, kind, color')
            .gte('starts_on', today).order('starts_on').limit(5),
          client.from('profiles').select('id, name, handle, member_no, created_at').order('member_no', { ascending: false }).limit(5),
          client.from('bans').select('profile_id, reason, created_at').order('created_at', { ascending: false }).limit(5),
        ])
        const failed = events.error || people.error || bans.error
        if (failed) throw failed
        const ids = (bans.data ?? []).map(ban => ban.profile_id)
        const banned = ids.length
          ? await client.from('profiles').select('id, name, handle, member_no, created_at').in('id', ids)
          : { data: [] as Person[], error: null }
        if (banned.error) throw banned.error
        const byId = new Map((banned.data ?? []).map(person => [person.id, person]))
        if (alive) setData({
          events: events.data ?? [],
          people: people.data ?? [],
          bans: (bans.data ?? []).map(ban => ({ ...ban, person: byId.get(ban.profile_id) })),
        })
      } catch (err) {
        if (alive) setError(errorText(err))
      }
    })()
    return () => { alive = false }
  }, [])

  return (
    <>
      <SectionHead title="Resumen" />
      {error && <p className="adm-error" role="alert">{error}</p>}
      <div className="adm-summary">
        <section aria-labelledby="sum-events">
          <div className="adm-sub"><h2 id="sum-events">Próximos eventos</h2><Link to="/admin/eventos" className="adm-link">Todos</Link></div>
          {!data ? <SkeletonRows rows={3} /> : data.events.length ? (
            <ul className="adm-ledger">
              {data.events.map(event => (
                <li key={event.id} className="adm-row adm-row-static">
                  <span className="adm-row-main"><strong>{event.name}</strong><small>{event.city}</small></span>
                  <time className="adm-mono" dateTime={event.starts_on}>{formatDate(event.starts_on)}</time>
                </li>
              ))}
            </ul>
          ) : <Empty>No hay eventos próximos. Crea uno en <Link to="/admin/eventos">Eventos</Link>.</Empty>}
        </section>

        <section aria-labelledby="sum-people">
          <div className="adm-sub"><h2 id="sum-people">Últimas altas</h2><Link to="/admin/usuarios" className="adm-link">Todas</Link></div>
          {!data ? <SkeletonRows rows={3} /> : data.people.length ? (
            <ul className="adm-ledger">
              {data.people.map(person => (
                <li key={person.id} className="adm-row adm-row-static">
                  <span className="adm-row-main"><strong>{person.name || 'Sin nombre'}</strong><small className="adm-mono">{person.handle ? `@${person.handle}` : 'sin usuario'}</small></span>
                  <span className="adm-mono">{String(person.member_no).padStart(4, '0')}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>Nadie se ha registrado todavía.</Empty>}
        </section>

        <section aria-labelledby="sum-bans">
          <div className="adm-sub"><h2 id="sum-bans">Bloqueos recientes</h2></div>
          {!data ? <SkeletonRows rows={2} /> : data.bans.length ? (
            <ul className="adm-ledger">
              {data.bans.map(ban => (
                <li key={ban.profile_id} className="adm-row adm-row-static">
                  <span className="adm-row-main"><strong>{ban.person?.name || 'Sin nombre'}</strong><small>{ban.reason || 'Sin motivo'}</small></span>
                  <time className="adm-mono" dateTime={ban.created_at}>{formatDate(ban.created_at)}</time>
                </li>
              ))}
            </ul>
          ) : <Empty>No hay nadie bloqueado.</Empty>}
        </section>
      </div>
    </>
  )
}
