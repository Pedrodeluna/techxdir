import { useEffect, useId, useRef, useState } from 'react'

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')

export function CitySelect({ cities, value, onChange }: {
  cities: string[]
  value: string | null
  onChange: (value: string | null, trigger: HTMLButtonElement) => void
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const options = [{ value: '', label: 'Toda España' }, ...cities.map(city => ({ value: city, label: city }))]
    .filter(option => normalize(option.label).includes(normalize(query.trim())))
  const activeIndex = Math.min(active, options.length - 1)

  useEffect(() => {
    if (!open) return
    input.current?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, id])

  function show() {
    setQuery('')
    setActive(Math.max(0, value ? cities.indexOf(value) + 1 : 0))
    setOpen(true)
  }
  function choose(next: string) {
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
    if (trigger.current) onChange(next || null, trigger.current)
  }

  return <div ref={root} className="atlas-city-field city-select" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus({ preventScroll: true })
    }
  }}>
    <span id={`${id}-label`} className="label">Ciudad</span>
    <button ref={trigger} type="button" className="city-select-trigger"
      aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={`${id}-options`} onClick={() => open ? setOpen(false) : show()}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show() }
      }}>
      <span id={`${id}-value`}>{value ?? 'Toda España'}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && <div className="city-select-menu">
      <input ref={input} type="text" role="combobox" aria-label="Buscar ciudad" placeholder="Buscar ciudad…"
        aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-options`}
        aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        value={query} onChange={event => { setQuery(event.target.value); setActive(0) }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const direction = event.key === 'ArrowDown' ? 1 : -1
            setActive(Math.max(0, Math.min(options.length - 1, activeIndex + direction)))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            if (options[activeIndex]) choose(options[activeIndex].value)
          }
        }} />
      <div id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`} className="city-select-options">
        {options.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option"
          aria-selected={option.value === (value ?? '')} className={index === activeIndex ? 'is-focused' : undefined}
          onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()}
          onClick={() => choose(option.value)}>
          <span>{option.label}</span><span aria-hidden="true">{option.value === (value ?? '') ? '✓' : ''}</span>
        </div>)}
      </div>
      {!options.length && <p className="city-select-empty" role="status">No hay ciudades con ese nombre.</p>}
    </div>}
  </div>
}
