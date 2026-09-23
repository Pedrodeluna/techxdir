import type { TechEvent } from '../../../data/sample'

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Descarga el evento como .ics de día completo. */
export function downloadIcs(e: TechEvent) {
  const ymd = (s: string) => s.replaceAll('-', '')
  const endExclusive = new Date(`${e.end || e.date}T00:00:00`)
  endExclusive.setDate(endExclusive.getDate() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  const endStr = `${endExclusive.getFullYear()}${pad(endExclusive.getMonth() + 1)}${pad(endExclusive.getDate())}`
  const icsText = (s: string) => String(s).replace(/[\\,;]/g, m => `\\${m}`)
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//techxdir//ES',
    'BEGIN:VEVENT',
    `UID:${e.id}@techxdir`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
    `DTSTART;VALUE=DATE:${ymd(e.date)}`,
    `DTEND;VALUE=DATE:${endStr}`,
    `SUMMARY:${icsText(e.name)}`,
    `LOCATION:${icsText(e.city)}`,
    ...(e.url ? [`URL:${e.url}`] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
  downloadBlob(new Blob([ics], { type: 'text/calendar' }), `${e.id}.ics`)
}
