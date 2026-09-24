import { SAMPLE, type Me, type Org, type Person, type TechEvent } from '../../data/sample'

/* Datos y cálculos de la acreditación. Sin React: funciones puras sobre el estado. */

export interface BadgeState {
  me: Me
  myEvents: string[]
  /** true con sesión: aún no hay personas reales y las fechas son de ejemplo */
  live?: boolean
}

/** Personas que puede ver esta acreditación: las de ejemplo solo en la acreditación de ejemplo */
export const peopleOf = (state: BadgeState): Person[] => (state.live ? [] : PEOPLE)

export type Section = 'bio' | 'events' | 'people'

export interface Contact extends Person {
  shared: TechEvent[]
}

export const ORGS = SAMPLE.orgs
export const EVENTS = SAMPLE.events
export const PEOPLE = SAMPLE.people
export const DEFAULT_ME = SAMPLE.me
export const DEFAULT_MY_EVENTS = SAMPLE.myEvents

export const EV = new Map(EVENTS.map(e => [e.id, e]))
export const ORG = new Map(ORGS.map(o => [o.id, o]))

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)

export const MOVE_MS = 1200 // el giro se hace siempre, también con "reducir movimiento"
export const LEAN = 12 // al llegar, la tarjeta queda un poco girada hacia el panel
// lado al que se desplaza la tarjeta según la zona pulsada
export const SIDE: Record<Section, 'left' | 'right'> = { bio: 'right', events: 'left', people: 'left' }

/* ───────── Utilidades ───────── */

export function hash(str: string) {
  let h = 2166136261
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export const initials = (name: string) =>
  (String(name).trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase()
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const day = (s: string) => new Date(`${s}T00:00:00`)
export const isPast = (e: TechEvent) => day(e.date) < TODAY
export const byDateAsc = (a: TechEvent, b: TechEvent) => a.date.localeCompare(b.date)
export const byDateDesc = (a: TechEvent, b: TechEvent) => b.date.localeCompare(a.date)

// año en que se sumó a la comunidad (los datos guardados antes no lo traen)
export const joinedYear = (me: Me) => me.joined || DEFAULT_ME.joined || TODAY.getFullYear()
// "Attendee · 0002"; sin número (datos guardados antes) solo "Attendee"
export const tierLabel = (me: Me) => (me.memberNo ? `Attendee · ${String(me.memberNo).padStart(4, '0')}` : 'Attendee')
export const cardId = (me: Me) => `TXD-${String(hash(me.handle) % 10000).padStart(4, '0')}`
export const avatarLightness = (name: string) => 70 + (hash(name) % 20)

export function fmtDate(e: TechEvent) {
  const d = day(e.date)
  return { day: d.getDate(), mon: MONTHS[d.getMonth()], year: d.getFullYear() }
}

export function fmtRange(e: TechEvent) {
  const a = day(e.date)
  const b = e.end ? day(e.end) : null
  const days = b ? Math.round((+b - +a) / 864e5) + 1 : 1
  let text: string
  if (!b) text = `${a.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()}`
  else if (a.getMonth() === b.getMonth()) text = `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()}`
  else text = `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`
  const weekday = a.toLocaleDateString('es-ES', { weekday: 'long' })
  return { text, days, weekday }
}

export function whenLabel(e: TechEvent) {
  const diff = Math.round((+day(e.date) - +TODAY) / 864e5)
  const end = e.end ? Math.round((+day(e.end) - +TODAY) / 864e5) : diff
  if (diff > 1) return `Dentro de ${diff} días`
  if (diff === 1) return 'Mañana'
  if (diff <= 0 && end >= 0) return 'Hoy'
  const ago = -end
  if (ago < 31) return `Hace ${plural(ago, 'día', 'días')}`
  const months = Math.round(ago / 30.4)
  return months < 12 ? `Hace ${plural(months, 'mes', 'meses')}` : `Hace ${plural(Math.round(months / 12), 'año', 'años')}`
}

export const pillLabel = (e: TechEvent, on: boolean) =>
  on ? (isPast(e) ? 'Fui ✓' : 'Voy ✓') : (isPast(e) ? 'Fui' : 'Voy')

/* ───────── Datos derivados ───────── */

export function contacts(myEvents: string[], people: Person[] = PEOPLE): Contact[] {
  const mine = new Set(myEvents)
  return people
    .map(p => ({ ...p, shared: p.events.filter(id => mine.has(id)).map(id => EV.get(id)!).sort(byDateDesc) }))
    .filter(p => p.shared.length)
    .sort((a, b) => b.shared.length - a.shared.length || a.name.localeCompare(b.name, 'es'))
}

// personas con las que no has coincidido en ningún evento
export function others(myEvents: string[], people: Person[] = PEOPLE): Contact[] {
  const matched = new Set(contacts(myEvents, people).map(p => p.id))
  return people
    .filter(p => !matched.has(p.id))
    .map(p => ({ ...p, shared: [] }))
    .sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name, 'es'))
}

export const contactsAt = (eventId: string, list: Person[]) => list.filter(p => p.events.includes(eventId)).length

export function myEventsSplit(myEvents: string[]) {
  const evs = myEvents.map(id => EV.get(id)).filter((e): e is TechEvent => Boolean(e))
  return {
    past: evs.filter(isPast).sort(byDateDesc),
    upcoming: evs.filter(e => !isPast(e)).sort(byDateAsc),
  }
}

export const orgOf = (e: TechEvent | undefined): Org | undefined => (e ? ORG.get(e.org) : undefined)
export const orgEvents = (o: Org) => EVENTS.filter(e => e.org === o.id)

// organizaciones con eventos marcados por ti, de más a menos eventos
export function myOrgs(myEvents: string[]) {
  const count = new Map<Org, number>()
  for (const id of myEvents) {
    const o = orgOf(EV.get(id))
    if (o) count.set(o, (count.get(o) || 0) + 1)
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name, 'es')).map(([o]) => o)
}

export function shareText(state: BadgeState) {
  const { past, upcoming } = myEventsSplit(state.myEvents)
  const n = contacts(state.myEvents, peopleOf(state)).length
  let text = `Mi acreditación en techxdir: ${plural(past.length, 'evento tech', 'eventos tech')} y ${plural(n, 'persona', 'personas')} con las que he coincidido.`
  if (upcoming[0]) text += ` Próximo: ${upcoming[0].name}. ¿Coincidimos?`
  return text
}
