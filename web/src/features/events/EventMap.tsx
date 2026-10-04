import { useId, useState } from 'react'
import type { TechEvent } from '../../data/sample'
import { fmtRange, isPast } from '../badge/model'
import { SPAIN_OUTLINE } from './spain-outline'
import { cityPoint } from './locations'
import './event-map.css'

export function EventMap({ events, onOpen, expanded = false }: { events: TechEvent[]; onOpen?: (id: string) => void; expanded?: boolean }) {
  const id = useId()
  const [city, setCity] = useState<string | null>(null)
  const [period, setPeriod] = useState('all')
  const [view, setView] = useState<'map' | 'list'>('map')
  const [query, setQuery] = useState('')
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
  const search = expanded ? normalize(query) : ''
  const filtered = events.filter(e =>
    (period === 'all' || (period === 'next' ? !isPast(e) : isPast(e))) &&
    (!search || normalize(`${e.name} ${e.city} ${e.kind}`).includes(search)),
  )
  const cities = [...new Set(filtered.map(e => e.city))].sort((a, b) => a.localeCompare(b, 'es'))
  const selected = city && cities.includes(city) ? city : null
  const selectedPoint = selected ? cityPoint(selected) : null
  const shown = filtered.filter(e => !selected || e.city === selected)
  const located = filtered.filter(e => cityPoint(e.city)).length
  return (
    <section className={`event-atlas${expanded ? ' event-atlas-expanded' : ''}`} aria-labelledby={`${id}-title`}>
      <header className="event-atlas-head">
        <div>
          <p className="label">{expanded ? 'Encuentros tech / España' : 'El punto de encuentro'}</p>
          {expanded ? <><h1 id={`${id}-title`}>Mapa y eventos.</h1><p className="atlas-intro">Encuentra tu próximo encuentro. Explora por ciudad o recorre la agenda.</p></> : <h2 id={`${id}-title`}>Nos vemos por aquí.</h2>}
        </div>
        <div className="atlas-filters" aria-label="Fechas de los eventos">
          {[['all', 'Todos'], ['next', 'Próximos'], ['past', 'Celebrados']].map(([value, label]) => <button type="button" className="pill" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}
        </div>
      </header>
      {expanded && <div className="atlas-search">
        <label htmlFor={`${id}-search`} className="label">Buscar encuentros</label>
        <div>
          <input id={`${id}-search`} type="search" placeholder="Evento, ciudad o tipo de encuentro" value={query} onChange={e => setQuery(e.target.value)} />
          {query && <button type="button" className="link" onClick={() => setQuery('')}>Limpiar</button>}
        </div>
      </div>}
      <div className="atlas-toolbar">
        <div className="atlas-view-switch" role="group" aria-label="Vista de eventos">
          <button type="button" aria-pressed={view === 'map'} aria-controls={`${id}-map`} onClick={() => setView('map')}>Mapa</button>
          <button type="button" aria-pressed={view === 'list'} aria-controls={`${id}-list`} onClick={() => setView('list')}>Lista</button>
        </div>
        <span className="label" aria-live="polite">{shown.length} eventos{selected ? ` · ${selected}` : ''}</span>
      </div>
      <div className="atlas-cities" aria-label="Filtrar por ciudad"><button type="button" className="pill" aria-pressed={!selected} onClick={() => setCity(null)}>Toda España</button>{cities.map(name => <button type="button" className="pill" key={name} aria-pressed={selected === name} onClick={() => setCity(name)}>{name}</button>)}</div>
      {expanded && !shown.length && view === 'map' && <p className="atlas-empty" role="status">No hay eventos con estos filtros. Prueba otra búsqueda o cambia las fechas.</p>}
      <div className="event-atlas-body">
        <div id={`${id}-map`} className="event-atlas-map" hidden={view !== 'map'}>
          <div className="atlas-caption"><span>ES / ATLAS DE ENCUENTROS</span><span>{String(cities.filter(name => cityPoint(name)).length).padStart(2, '0')} CIUDADES</span></div>
          <svg viewBox="0 50 760 520" aria-label="Mapa de ciudades con eventos">
            <defs>
              <pattern id={`${id}-grid`} width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".85" fill="currentColor" /></pattern>
              <pattern id={`${id}-survey`} width="60" height="60" patternUnits="userSpaceOnUse"><path d="M4 0H0V4M56 60H60V56" fill="none" stroke="currentColor" strokeWidth=".6" /></pattern>
            </defs>
            <g aria-hidden="true" className="atlas-survey">
              <rect x="35" y="80" width="690" height="450" fill={`url(#${id}-survey)`} />
              <path d="M35 100V80H55M705 80H725V100M35 510V530H55M705 530H725V510" fill="none" stroke="currentColor" />
              <text x="690" y="115" className="atlas-ocean">N ↑</text>
            </g>
            <g aria-hidden="true" transform="matrix(1 .08 -.16 .82 60 12)">
              {[9, 6, 3].map(d => <path key={d} d={SPAIN_OUTLINE} transform={`translate(0 ${d})`} className="atlas-land-depth" />)}
              <path d={SPAIN_OUTLINE} className="atlas-land" />
              <path d={SPAIN_OUTLINE} fill={`url(#${id}-grid)`} opacity=".3" />
              <path d="M65 470H270V574H65Z" fill="none" stroke="currentColor" opacity=".2" strokeDasharray="4 6" />
            </g>
            <text x="85" y="500" className="atlas-ocean">CANARIAS</text>
            <text x="530" y="420" className="atlas-ocean">MEDITERRÁNEO</text>
            {selectedPoint && <g key={selected} aria-hidden="true" className="atlas-locator">
              <path d={`M35 ${selectedPoint.y - 24}H725M${selectedPoint.x} 80V530`} />
            </g>}
            {cities.map(name => {
              const p = cityPoint(name)
              if (!p) return null
              const active = selected === name
              const height = 24
              const count = filtered.filter(e => e.city === name).length
              return <g key={name} className={`atlas-pin${active ? ' is-active' : ''}`} role="button" tabIndex={0} aria-label={`Ver ${count} eventos en ${name}`} aria-pressed={active} onClick={() => setCity(active ? null : name)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCity(active ? null : name) } }}>
                <title>{name}</title><circle cx={p.x} cy={p.y - height} r="23" fill="transparent" />
                <path d={`M${p.x} ${p.y}v-${height}`} stroke="currentColor" />
                <ellipse cx={p.x} cy={p.y} rx="9" ry="3" className="atlas-pin-base" />
                <circle cx={p.x} cy={p.y - height} r="13" className="atlas-pin-ring" />
                <circle cx={p.x} cy={p.y - height} r={active ? 6 : 4} className="atlas-dot" />
                {active && <path className="atlas-pin-target" d={`M${p.x - 20} ${p.y - height - 11}v-9h9m22 0h9v9m0 22v9h-9m-22 0h-9v-9`} />}
                <text x={p.x + 25} y={p.y - height + 1}>{name}</text>
                <text x={p.x + 25} y={p.y - height + 17} className="atlas-pin-count">{String(count).padStart(2, '0')} {count === 1 ? 'EVENTO' : 'EVENTOS'}</text>
              </g>
            })}
          </svg>
          <div className="atlas-map-selection">
            <span>{selected ?? 'Toda España'}</span>
            <button type="button" className="link" onClick={() => setView('list')}>Ver {shown.length} eventos →</button>
          </div>
        </div>
        <div id={`${id}-list`} className="atlas-agenda" hidden={view !== 'list'}>
          <div className="atlas-event-list" aria-live="polite">
            {shown.map(e => <article key={e.id} className="atlas-event"><span className="label">{fmtRange(e).text} · {isPast(e) ? 'Celebrado' : 'Próximo'}</span><h4>{onOpen ? <button type="button" data-event={e.id} onClick={() => onOpen(e.id)}>{e.name} ↗</button> : e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.name} ↗</a> : e.name}</h4><p>{e.city} · {e.kind}</p></article>)}
            {!shown.length && <p className="atlas-empty">No hay eventos con estos filtros. Prueba otra búsqueda o cambia las fechas.</p>}
          </div>
        </div>
      </div>
      <footer className="atlas-foot"><span>{located} en el mapa · {filtered.length - located} online o sin ubicación en el mapa</span><span>Consulta los detalles con cada organizador.</span></footer>
    </section>
  )
}
