import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react'
import type { TechEvent } from '../../data/sample'
import { fmtRange, isPast } from '../badge/model'
import { EventCalendar } from './EventCalendar'
import { CitySelect } from './CitySelect'
import { SPAIN_OUTLINE } from './spain-outline'
import { cityPoint, PENINSULA_OFFSET, PENINSULA_SCALE } from './locations'
import './event-map.css'

// Keep the island insets fixed while moving mainland geometry and pins together.
const landParts = (SPAIN_OUTLINE.match(/M[^M]+/g) ?? []).map(path => {
  const [x, y] = path.slice(1).match(/[\d.]+/g)!.slice(0, 2).map(Number)
  return { path, mainland: y < 480 && !(x > 550 && y > 280) }
})

interface MapFilters { city: string | null; period: string; view: 'map' | 'list' | 'calendar'; query: string }
function readFilters(key?: string): MapFilters {
  const fallback: MapFilters = { city: null, period: 'next', view: 'map', query: '' }
  if (!key) return fallback
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (!saved) return fallback
    return { city: typeof saved.city === 'string' ? saved.city : null,
      period: (saved.view === 'list' || saved.view === 'calendar') && ['all', 'next', 'past'].includes(saved.period) ? saved.period : 'next',
      view: saved.view === 'calendar' ? 'calendar' : saved.view === 'list' ? 'list' : 'map', query: typeof saved.query === 'string' ? saved.query : '' }
  } catch { return fallback }
}

export function EventMap({ events, onOpen, expanded = false, searchable = false, persistenceKey }: {
  events: TechEvent[]; onOpen?: (id: string) => void; expanded?: boolean; searchable?: boolean; persistenceKey?: string
}) {
  const id = useId()
  const [initial] = useState(() => readFilters(persistenceKey))
  const [city, setCity] = useState<string | null>(initial.city)
  const [period, setPeriod] = useState(initial.period)
  const [view, setView] = useState<'map' | 'list' | 'calendar'>(initial.view)
  const [query, setQuery] = useState(initial.query)
  const popupRef = useRef<HTMLDivElement>(null)
  const mapStageRef = useRef<HTMLDivElement>(null)
  const mapSvgRef = useRef<SVGSVGElement>(null)
  const listButtonRef = useRef<HTMLButtonElement>(null)
  const cityTriggerRef = useRef<HTMLElement | SVGElement | null>(null)
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
  const search = normalize(query)
  useEffect(() => {
    if (persistenceKey) {
      try { sessionStorage.setItem(persistenceKey, JSON.stringify({ city, period, view, query })) } catch { /* storage unavailable */ }
    }
  }, [persistenceKey, city, period, view, query])
  const filtered = events.filter(e =>
    (view === 'map' ? !isPast(e) : period === 'all' || (period === 'next' ? !isPast(e) : isPast(e))) &&
    (!search || normalize(`${e.name} ${e.city} ${e.kind}`).includes(search)),
  )
  const cities = [...new Set(filtered.map(e => e.city))].sort((a, b) => a.localeCompare(b, 'es'))
  const selected = city && cities.includes(city) ? city : null
  const selectedPoint = selected ? cityPoint(selected, cities) : null
  const shown = filtered.filter(e => !selected || e.city === selected)
  const located = filtered.filter(e => cityPoint(e.city)).length
  const cityEventsVisible = view === 'map' && Boolean(selected)

  const closeCity = () => {
    setCity(null)
    cityTriggerRef.current?.focus({ preventScroll: true })
  }
  const selectCity = (name: string, trigger: HTMLElement | SVGElement) => {
    cityTriggerRef.current = trigger
    if (selected === name) closeCity()
    else setCity(name)
  }
  const showList = () => {
    setView('list')
    listButtonRef.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (cityEventsVisible) popupRef.current?.focus({ preventScroll: true })
  }, [cityEventsVisible, selected])

  useLayoutEffect(() => {
    if (!cityEventsVisible) return
    const stage = mapStageRef.current
    const svg = mapSvgRef.current
    const popup = popupRef.current
    if (!stage || !svg || !popup) return
    const position = () => {
      // En móvil la ficha permanece en el flujo, debajo del mapa.
      if (matchMedia('(max-width: 600px)').matches) return
      const bounds = stage.getBoundingClientRect()
      const matrix = svg.getScreenCTM()
      if (!matrix) return
      const point = selectedPoint
        ? new DOMPoint(selectedPoint.head.x, selectedPoint.head.y).matrixTransform(matrix)
        : new DOMPoint(bounds.left + bounds.width / 2, bounds.top + 32)
      const x = point.x - bounds.left
      const y = point.y - bounds.top
      const padding = 12
      const gap = 28
      const mapHeight = svg.getBoundingClientRect().height
      const maxHeight = Math.max(120, Math.min(520, mapHeight - padding * 2, innerHeight - 48))
      stage.style.setProperty('--popup-height', `${maxHeight}px`)
      const width = popup.offsetWidth
      const height = Math.min(popup.offsetHeight, maxHeight)
      const beside = x + gap + width <= bounds.width - padding ? x + gap : x - gap - width
      const left = Math.max(padding, Math.min(beside, bounds.width - width - padding))
      const top = Math.max(padding, Math.min(y - 32, mapHeight - height - padding))
      stage.style.setProperty('--popup-left', `${left}px`)
      stage.style.setProperty('--popup-top', `${top}px`)
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(svg)
    observer.observe(popup)
    window.addEventListener('resize', position)
    return () => { observer.disconnect(); window.removeEventListener('resize', position) }
  }, [cityEventsVisible, selectedPoint?.head.x, selectedPoint?.head.y, shown.length])

  const eventRows = shown.map(e => (
    <article key={e.id} className="atlas-event">
      <span className="label">{fmtRange(e).text} · {isPast(e) ? 'Celebrado' : 'Próximo'}</span>
      <h4>{onOpen ? <button type="button" data-event={e.id} onClick={() => onOpen(e.id)}>{e.name} ↗</button> : e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.name} ↗</a> : e.name}</h4>
      <p>{e.city} · {e.kind}</p>
    </article>
  ))

  return (
    <section className={`event-atlas${expanded ? ' event-atlas-expanded' : ''}`} aria-labelledby={`${id}-title`}>
      <header className="event-atlas-head">
        <div>
          <p className="label">{expanded ? 'Encuentros tech / España' : 'El punto de encuentro'}</p>
          {expanded ? <><h1 id={`${id}-title`}>Mapa y eventos.</h1><p className="atlas-intro">Encuentra tu próximo encuentro. Explora por ciudad o recorre la agenda.</p></> : <h2 id={`${id}-title`}>Nos vemos por aquí.</h2>}
        </div>
        <div className="atlas-filters" aria-label="Fechas de los eventos">
          {[['all', 'Todos'], ['next', 'Próximos'], ['past', 'Celebrados']].filter(([value]) => view !== 'map' || value !== 'all').map(([value, label]) => <button type="button" className="pill" key={value} aria-pressed={period === value} onClick={() => { setPeriod(value); if (value === 'past' && view === 'map') setView('list') }}>{label}</button>)}
        </div>
      </header>
      <div className="atlas-controls">
      {(expanded || searchable) && <div className="atlas-search">
        <label htmlFor={`${id}-search`} className="label">Buscar encuentros</label>
        <div>
          <input id={`${id}-search`} type="search" placeholder="Evento, ciudad o tipo de encuentro" value={query} onChange={e => setQuery(e.target.value)} />
          {query && <button type="button" className="link" onClick={() => setQuery('')}>Limpiar</button>}
        </div>
      </div>}
        <CitySelect cities={cities} value={selected} onChange={(next, trigger) => {
          cityTriggerRef.current = trigger
          setCity(next)
        }} />
      </div>
      <div className="atlas-toolbar">
        <div className="atlas-view-switch" role="group" aria-label="Vista de eventos">
          <button type="button" aria-pressed={view === 'map'} aria-controls={`${id}-map`} onClick={() => { setPeriod('next'); setView('map') }}>Mapa</button>
          <button ref={listButtonRef} type="button" aria-pressed={view === 'list'} aria-controls={`${id}-list`} onClick={showList}>Lista</button>
          <button type="button" aria-pressed={view === 'calendar'} aria-controls={`${id}-calendar`} onClick={() => setView('calendar')}>Calendario</button>
        </div>
        <span className="label" aria-live="polite">{shown.length} eventos{selected ? ` · ${selected}` : ''}</span>
      </div>

      {!shown.length && view === 'map' && <p className="atlas-empty" role="status">No hay eventos con estos filtros. Prueba otra búsqueda o cambia las fechas.</p>}
      <div className="event-atlas-body">
        <div id={`${id}-map`} className="event-atlas-map" hidden={view !== 'map'}>
          <div className="atlas-caption"><span>ES / PRÓXIMOS ENCUENTROS</span><span>{String(cities.filter(name => cityPoint(name)).length).padStart(2, '0')} CIUDADES</span></div>
          <div className="atlas-map-stage" ref={mapStageRef}>
          <svg ref={mapSvgRef} viewBox="0 20 800 570" aria-label="Mapa de ciudades con eventos" onClick={event => {
            if (cityEventsVisible && !(event.target as Element).closest('.atlas-pin')) closeCity()
          }}>
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
              {landParts.map(({ path, mainland }) => <g key={path} transform={mainland ? `translate(${PENINSULA_OFFSET.x} ${PENINSULA_OFFSET.y}) scale(${PENINSULA_SCALE})` : undefined}>
                {[9, 6, 3].map(d => <path key={d} d={path} transform={`translate(0 ${d})`} className="atlas-land-depth" />)}
                <path d={path} className="atlas-land" />
                <path d={path} fill={`url(#${id}-grid)`} opacity=".3" />
              </g>)}
            </g>
                  {cities.map(name => {
                    const p = cityPoint(name, cities)
                    if (!p) return null
                    const islandCities = cities.filter(city => cityPoint(city)?.region === p.region)
                      .sort((a, b) => cityPoint(a)!.x - cityPoint(b)!.x)
                    const islandIndex = islandCities.indexOf(name)
                    const label = p.text
                      ? { x: p.x + p.text.dx, y: p.y + p.text.dy, anchor: p.text.anchor }
                      : p.region === 'canarias'
                      ? { x: p.x + (islandIndex > 1 ? 65 : 0), y: 507 + (islandIndex % 2) * 42, anchor: 'middle' as const }
                      : p.region === 'baleares'
                        ? { x: p.x, y: 385 + (islandIndex % 2 === 0 ? 30 : 0), anchor: 'middle' as const }
                        : { x: p.x + (p.x > 570 ? -25 : 25), y: p.y - 24, anchor: p.x > 570 ? 'end' as const : 'start' as const }
                    const active = selected === name
                    const count = filtered.filter(event => event.city === name).length
                    return <g key={name} className={`atlas-pin${active ? ' is-active' : ''}`}
                      role="button" tabIndex={0} aria-label={`${p.label}: ${count} eventos`} aria-pressed={active}
                      onClick={event => selectCity(name, event.currentTarget)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCity(name, event.currentTarget) }
                      }}>
                      <title>{p.label}: {count} eventos</title>
                      <circle cx={p.head.x} cy={p.head.y} r="23" fill="transparent" />
                      <path d={`M${p.x} ${p.y}L${p.head.x} ${p.head.y}`} stroke="currentColor" />
                      <ellipse cx={p.x} cy={p.y} rx="9" ry="3" className="atlas-pin-base" />
                      <circle cx={p.head.x} cy={p.head.y} r="13" className="atlas-pin-ring" />
                      <circle cx={p.head.x} cy={p.head.y} r={active ? 6 : 4} className="atlas-dot" />
                      {p.region !== 'peninsula' && <path className="atlas-label-line" d={`M${p.x} ${p.y + 6}L${label.x} ${label.y - 13}`} />}
                      <text className={p.region === 'peninsula' ? 'atlas-pin-name' : 'atlas-pin-name atlas-island-name'} x={label.x} y={label.y} textAnchor={label.anchor}>{p.label}</text>
                    </g>
                  })}
          </svg>
          {cityEventsVisible && <div
            ref={popupRef}
            className="atlas-city-popup"
            role="dialog"
            aria-modal="false"
            aria-labelledby={`${id}-city-title`}
            tabIndex={-1}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCity() }
            }}
          >
            <header className="atlas-popup-head">
              <div><p className="label">{shown.length} {shown.length === 1 ? 'encuentro' : 'encuentros'}</p><h3 id={`${id}-city-title`}>{selected}</h3></div>
              <button type="button" className="atlas-popup-close" aria-label="Cerrar eventos de la ciudad" onClick={closeCity}>×</button>
            </header>
            <div className="atlas-popup-events" aria-live="polite">{eventRows}</div>
            <footer className="atlas-popup-foot"><button type="button" className="link" onClick={showList}>Ver la lista completa →</button></footer>
          </div>}
          </div>
          <div className="atlas-map-selection">
            <span>{selected ?? 'Toda España'}</span>
            <button type="button" className="link" onClick={showList}>{selected ? 'Ver solo la lista →' : `Ver ${shown.length} eventos →`}</button>
          </div>
        </div>
        <div id={`${id}-calendar`} hidden={view !== 'calendar'}><EventCalendar events={shown} onOpen={onOpen} /></div>
        <div id={`${id}-list`} className="atlas-agenda" hidden={view !== 'list'}>
          <div className="atlas-event-list" aria-live="polite">
            {eventRows}
            {!shown.length && <p className="atlas-empty">No hay eventos con estos filtros. Prueba otra búsqueda o cambia las fechas.</p>}
          </div>
        </div>
      </div>
      <footer className="atlas-foot" hidden={view === 'calendar'}><span>{located} en el mapa · {filtered.length - located} online o sin ubicación en el mapa</span><span>En el mapa se muestra únicamente los eventos futuros</span></footer>
    </section>
  )
}
