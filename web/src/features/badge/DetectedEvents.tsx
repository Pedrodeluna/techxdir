import { useState } from 'react'
import type { TechEvent } from '../../data/sample'
import { fmtDate, plural, type BadgeState } from './model'

/* "Te hemos visto en N eventos": asistencias que Luma muestra y que aún no has confirmado.
   No se publican hasta que las confirmas. */
export function DetectedEvents({ state, notify }: { state: BadgeState; notify: (text: string) => void }) {
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const index = new Map((state.catalog?.events ?? []).map(e => [e.id, e]))
  const events = (state.detected ?? []).map(id => index.get(id)).filter((e): e is TechEvent => Boolean(e))
  if (hidden || !events.length || !state.reviewDetected) return null

  async function review(ids: string[], accept: boolean) {
    setBusy(true)
    const ok = await state.reviewDetected!(ids, accept)
    setBusy(false)
    if (!ok) return notify('No se ha podido guardar. Prueba de nuevo.')
    notify(accept ? `${plural(ids.length, 'evento añadido', 'eventos añadidos')} a tu acreditación` : 'Descartado')
  }

  return (
    <aside className="detected" aria-labelledby="detected-title" aria-busy={busy}>
      <strong id="detected-title">Te hemos visto en {plural(events.length, 'evento', 'eventos')}</strong>
      <p>Apareces en la lista pública de Luma. Confírmalos para añadirlos a tu acreditación; nadie más los ve hasta entonces.</p>
      <ul>
        {events.map(e => {
          const d = fmtDate(e)
          return (
            <li key={e.id}>
              <span className="detected-date">{d.day} {d.mon}</span>
              <span className="detected-name">{e.name}<small>{e.city}</small></span>
              <span className="detected-actions">
                <button type="button" className="pill is-on" disabled={busy} onClick={() => review([e.id], true)}>Confirmar</button>
                <button type="button" className="link" disabled={busy} onClick={() => review([e.id], false)}>Descartar</button>
              </span>
            </li>
          )
        })}
      </ul>
      <div className="detected-foot">
        {events.length > 1 && <button type="button" className="pill" disabled={busy} onClick={() => review(events.map(e => e.id), true)}>Confirmar todos</button>}
        <button type="button" className="link" onClick={() => setHidden(true)}>Ahora no</button>
      </div>
    </aside>
  )
}
