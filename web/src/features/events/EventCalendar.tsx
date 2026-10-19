import { useId, useState } from 'react'
import type { TechEvent } from '../../data/sample'
import { fmtRange } from '../badge/model'
import { dateKey, eventsOnDay, monthDays, shiftMonth, shiftDay, weekDays } from './calendar'
import './event-calendar.css'

/* THESIS: A printed monthly planner extends the existing event explorer.
 * OWN-WORLD: Paper, ink, hairlines, mono dates; one small today signal.
 * STORY: Scan the month, choose a day, open an encounter in its existing detail.
 * FIRST VIEWPORT: Month and navigation above seven columns; daily agenda below.
 * FORM: Existing surface extension, weekly strip with a full daily agenda on narrow containers.
 */
export function EventCalendar({ events, onOpen }: { events: TechEvent[]; onOpen?: (id: string) => void }) {
  const id = useId()
  const [view, setView] = useState<'week' | 'month'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches ? 'week' : 'month',
  )
  const today = dateKey(new Date())
  const [month, setMonth] = useState(today.slice(0, 7))
  const [selected, setSelected] = useState(today)
  const days = monthDays(month)
  const week = weekDays(selected)
  const weekCount = events.filter(e => e.date <= week[6] && (e.end ?? e.date) >= week[0]).length
  const daily = eventsOnDay(events, selected)
  const monthCount = events.filter(e => e.date <= `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate())}` && (e.end ?? e.date) >= `${month}-01`).length
  const label = (day: string, options: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00`).toLocaleDateString('es-ES', options)
  const navigate = (offset: number) => {
    const next = shiftMonth(month, offset)
    setMonth(next)
    setSelected(`${next}-01`)
  }
  const selectDay = (day: string) => {
    setSelected(day)
    setMonth(day.slice(0, 7))
  }
  return <div className="event-calendar" data-view={view}>
    <div className="calendar-view-switch atlas-view-switch" role="group" aria-label="Periodo del calendario">
      <button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>Semana</button>
      <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>Mes</button>
    </div>
    <div className="calendar-week-view">
      <header className="calendar-head">
        <div><h3 id={`${id}-week`}>{label(week[0], { day: 'numeric', month: 'short' })} – {label(week[6], { day: 'numeric', month: 'short', year: 'numeric' })}</h3>
          <p>{weekCount} {weekCount === 1 ? 'encuentro esta semana' : 'encuentros esta semana'}</p></div>
        <div className="calendar-navigation" role="group" aria-label="Navegar por semanas">
          <button type="button" className="pill" aria-label="Semana anterior" onClick={() => selectDay(shiftDay(selected, -7))}>←</button>
          <button type="button" className="pill" onClick={() => selectDay(today)}>Hoy</button>
          <button type="button" className="pill" aria-label="Semana siguiente" onClick={() => selectDay(shiftDay(selected, 7))}>→</button>
        </div>
      </header>
      <div className="calendar-week-strip" role="group" aria-labelledby={`${id}-week`}>
        {week.map(day => {
          const count = eventsOnDay(events, day).length
          return <button type="button" key={day} className="calendar-week-day" aria-pressed={selected === day}
            aria-current={today === day ? 'date' : undefined} aria-controls={`${id}-agenda`}
            aria-label={`${label(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${count} eventos`}
            onClick={() => selectDay(day)}>
            <span className="calendar-week-label">{label(day, { weekday: 'short' })}</span>
            <span className="calendar-week-number">{Number(day.slice(-2))}</span>
            <span className={`calendar-week-indicator${count ? ' has-events' : ''}`} aria-hidden="true" />
          </button>
        })}
      </div>
    </div>
    <div className="calendar-month-view">
    <header className="calendar-head">
      <div><h3 id={`${id}-month`}>{label(`${month}-01`, { month: 'long', year: 'numeric' })}</h3>
        <p>{monthCount} {monthCount === 1 ? 'encuentro este mes' : 'encuentros este mes'}</p></div>
      <div className="calendar-navigation" role="group" aria-label="Navegar por meses">
        <button type="button" className="pill" aria-label="Mes anterior" onClick={() => navigate(-1)}>←</button>
        <button type="button" className="pill" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today) }}>Hoy</button>
        <button type="button" className="pill" aria-label="Mes siguiente" onClick={() => navigate(1)}>→</button>
      </div>
    </header>
    <div className="calendar-weekdays" aria-hidden="true">{['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid" role="group" aria-labelledby={`${id}-month`}>
      {days.map(day => {
        const entries = eventsOnDay(events, day)
        const outside = !day.startsWith(month)
        return <button type="button" key={day} className={`calendar-day${outside ? ' is-outside' : ''}`}
          aria-pressed={selected === day} aria-current={today === day ? 'date' : undefined}
          aria-controls={`${id}-agenda`} aria-label={`${label(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${entries.length} eventos`}
          onClick={() => { setSelected(day); if (outside) setMonth(day.slice(0, 7)) }}>
          <span className="calendar-date">{Number(day.slice(-2))}{day === today && <span className="calendar-today" />}</span>
          <span className="calendar-preview" aria-hidden="true">{entries.slice(0, 2).map(e => <span key={e.id}>{e.name}</span>)}{entries.length > 2 && <span className="calendar-more">+{entries.length - 2} más</span>}</span>
          {entries.length > 0 && <span className="calendar-count" aria-hidden="true">{entries.length}</span>}
        </button>
      })}
    </div>
    </div>
    <section id={`${id}-agenda`} className="calendar-agenda" aria-labelledby={`${id}-day`} aria-live="polite">
      <header><h3 id={`${id}-day`}>{label(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</h3><span className="label">{daily.length} eventos</span></header>
      {daily.length ? daily.map(event => <article className="atlas-event" key={event.id}>
        <span className="label">{fmtRange(event).text}</span>
        <h4>{onOpen ? <button type="button" onClick={() => onOpen(event.id)}>{event.name} ↗</button> : event.url ? <a href={event.url} target="_blank" rel="noopener noreferrer">{event.name} ↗</a> : event.name}</h4>
        <p>{event.city} · {event.kind}</p>
      </article>) : <p className="atlas-empty">No hay encuentros este día con los filtros actuales. Selecciona otro día o cambia los filtros.</p>}
    </section>
  </div>
}
