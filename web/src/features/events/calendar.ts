import type { TechEvent } from '../../data/sample'

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function shiftMonth(month: string, offset: number): string {
  const [year, index] = month.split('-').map(Number)
  return dateKey(new Date(year, index - 1 + offset, 1)).slice(0, 7)
}

export function monthDays(month: string): string[] {
  const [year, index] = month.split('-').map(Number)
  const first = new Date(year, index - 1, 1)
  const offset = (first.getDay() + 6) % 7
  const count = Math.ceil((offset + new Date(year, index, 0).getDate()) / 7) * 7
  return Array.from({ length: count }, (_, day) => dateKey(new Date(year, index - 1, 1 - offset + day)))
}

export function eventsOnDay(events: TechEvent[], day: string): TechEvent[] {
  return events.filter(event => event.date <= day && (event.end ?? event.date) >= day)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'es'))
}

/** Calendar-day arithmetic preserves local dates across daylight-saving changes. */
export function shiftDay(day: string, offset: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return dateKey(new Date(year, month - 1, date + offset))
}

export function weekDays(day: string): string[] {
  const weekday = new Date(`${day}T12:00:00`).getDay()
  const offset = (weekday + 6) % 7
  return Array.from({ length: 7 }, (_, index) => shiftDay(day, index - offset))
}
