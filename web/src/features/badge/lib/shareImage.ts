import type { Org } from '../../../data/sample'
import { contacts, fmtDate, hash, initials, joinedYear, myEventsSplit, myOrgs, plural, type BadgeState } from '../model'

/* Imagen para compartir en redes. Canvas puro: no depende del DOM de la acreditación. */

// Dibuja la acreditación en un PNG 1080×1350 (formato 4:5, el que mejor encaja en redes)
export async function renderCardImage(state: BadgeState): Promise<Blob> {
  await document.fonts.ready
  const W = 1080
  const H = 1350
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')!

  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  const BG = v('--bg', '#ebeae6')
  const CARD = v('--card', '#fbfbf9')
  const INK = v('--ink', '#111113')
  const MUTED = v('--muted', '#8b8a90')
  const LINE = v('--line', 'rgba(17,17,19,.1)')
  const SANS = '"Space Grotesk", system-ui, sans-serif'
  const MONO = '"JetBrains Mono", ui-monospace, monospace'

  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath()
    g.moveTo(x + r, y)
    g.arcTo(x + w, y, x + w, y + h, r)
    g.arcTo(x + w, y + h, x, y + h, r)
    g.arcTo(x, y + h, x, y, r)
    g.arcTo(x, y, x + w, y, r)
    g.closePath()
  }
  const text = (str: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left', spacing = 0) => {
    g.font = font
    g.fillStyle = color
    g.textAlign = align
    g.textBaseline = 'alphabetic'
    if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`
    g.fillText(str, x, y)
    if ('letterSpacing' in g) g.letterSpacing = '0px'
  }
  const fit = (str: string, font: string, maxW: number) => {
    g.font = font
    if (g.measureText(str).width <= maxW) return str
    while (str.length > 1 && g.measureText(`${str}…`).width > maxW) str = str.slice(0, -1)
    return `${str.trimEnd()}…`
  }
  const hr = (y: number) => {
    g.fillStyle = LINE
    g.fillRect(P, y, cw - 2 * P, 1.5)
  }

  const me = state.me
  const { past, upcoming } = myEventsSplit(state.myEvents)
  const people = contacts(state.myEvents)
  const orgs = myOrgs(state.myEvents)

  // fondo y tarjeta
  g.fillStyle = BG
  g.fillRect(0, 0, W, H)
  const cw = 740
  const ch = 1110
  const cx = (W - cw) / 2
  const cy = (H - ch) / 2
  const P = 40

  g.save()
  g.shadowColor = 'rgba(0, 0, 0, .16)'
  g.shadowBlur = 70
  g.shadowOffsetY = 34
  g.fillStyle = CARD
  rr(cx, cy, cw, ch, 34)
  g.fill()
  g.restore()
  g.strokeStyle = LINE
  g.lineWidth = 1.5
  rr(cx, cy, cw, ch, 34)
  g.stroke()

  g.save()
  g.translate(cx, cy)

  // agujero de la cinta
  g.fillStyle = BG
  rr(cw / 2 - 38, 22, 76, 12, 6)
  g.fill()

  // cabecera
  text('techx', P, 76, `600 30px ${SANS}`, INK)
  const tw = g.measureText('techx').width
  text('dir', P + tw, 76, `600 30px ${SANS}`, MUTED)
  text('ATTENDEE', cw - P, 74, `500 17px ${MONO}`, MUTED, 'right', 2.5)

  // foto
  const px = P
  const py = 112
  const pw = (cw - 2 * P - 14) / 2
  const ph = pw * 1.25
  g.save()
  rr(px, py, pw, ph, 24)
  g.clip()
  g.fillStyle = '#e3e2dd'
  g.fillRect(px, py, pw, ph)
  let drewPhoto = false
  if (me.photo && me.photo.startsWith('data:')) {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = reject
        i.src = me.photo!
      })
      const s = Math.max(pw / img.naturalWidth, ph / img.naturalHeight)
      const iw = img.naturalWidth * s
      const ih = img.naturalHeight * s
      g.drawImage(img, px + (pw - iw) / 2, py + (ph - ih) / 2, iw, ih)
      drewPhoto = true
    } catch { /* sin foto: iniciales */ }
  }
  if (!drewPhoto) {
    g.textBaseline = 'middle'
    g.font = `300 104px ${SANS}`
    g.fillStyle = INK
    g.textAlign = 'center'
    g.fillText(initials(me.name), px + pw / 2, py + ph / 2 + 4)
  }
  g.restore()

  // eventos
  const ex = px + pw + 14 + 24
  const colW = cw - P - ex
  text('EVENTOS', ex, 152, `500 17px ${MONO}`, MUTED, 'left', 2.5)
  text(String(past.length), ex - 6, 408, `300 172px ${SANS}`, INK, 'left', -8)
  const next = upcoming[0] || past[0]
  if (next) {
    const d = fmtDate(next)
    text(upcoming[0] ? 'Próximo' : 'Último', ex, 458, `400 22px ${SANS}`, MUTED)
    const line = upcoming[0] ? `${next.short} · ${d.day} ${d.mon}` : `${next.short} · ${d.mon} ${d.year}`
    text(fit(line, `500 24px ${SANS}`, colW), ex, 490, `500 24px ${SANS}`, INK)
  }

  // identidad
  hr(560)
  let size = 64
  const name = me.name || 'Tu nombre'
  g.font = `500 ${size}px ${SANS}`
  while (size > 36 && g.measureText(name).width > cw - 2 * P) {
    size -= 2
    g.font = `500 ${size}px ${SANS}`
  }
  text(fit(name, `500 ${size}px ${SANS}`, cw - 2 * P), P, 640, `500 ${size}px ${SANS}`, INK, 'left', -1.5)
  const role = [me.role, me.company].filter(Boolean).join(' · ')
  if (role) text(fit(role, `400 25px ${SANS}`, cw - 2 * P), P, 684, `400 25px ${SANS}`, MUTED)
  text(`@${me.handle}`, P, 722, `400 23px ${MONO}`, INK)

  // organizaciones
  hr(762)
  text(`${plural(orgs.length, 'ORGANIZACIÓN', 'ORGANIZACIONES')}`, P, 814, `500 17px ${MONO}`, MUTED, 'left', 2.5)
  const LOGO = 46
  const shownOrgs = orgs.slice(0, 6)
  shownOrgs.forEach((o, i) => {
    const x = cw - P - (shownOrgs.length - i) * (LOGO + 10) + 10
    drawOrg(o, x, 808 - LOGO / 2, LOGO)
  })

  // coincidencias
  hr(854)
  text('COINCIDENCIAS', P, 904, `500 17px ${MONO}`, MUTED, 'left', 2.5)
  text(String(people.length), P - 4, 1016, `300 132px ${SANS}`, INK, 'left', -6)
  g.font = `300 132px ${SANS}`
  if ('letterSpacing' in g) g.letterSpacing = '-6px'
  const nw = g.measureText(String(people.length)).width
  if ('letterSpacing' in g) g.letterSpacing = '0px'
  text(people.length === 1 ? 'persona' : 'personas', P + nw + 10, 1016, `400 28px ${SANS}`, MUTED)

  const AV = 62
  const avs = people.slice(0, 4).map(p => ({ label: initials(p.name), fill: `hsl(40 6% ${70 + (hash(p.name) % 20)}%)`, color: INK }))
  if (people.length > 4) avs.push({ label: `+${people.length - 4}`, fill: INK, color: CARD })
  avs.forEach((a, i) => {
    const x = cw - P - AV / 2 - (avs.length - 1 - i) * (AV - 14)
    const y = 992
    g.beginPath()
    g.arc(x, y, AV / 2, 0, Math.PI * 2)
    g.fillStyle = a.fill
    g.fill()
    g.lineWidth = 4
    g.strokeStyle = CARD
    g.stroke()
    g.font = `500 21px ${SANS}`
    g.fillStyle = a.color
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(a.label, x, y + 1)
  })

  // pie
  hr(1046)
  text(`TXD-${String(hash(me.handle) % 10000).padStart(4, '0')}`, P, 1082, `500 17px ${MONO}`, MUTED, 'left', 2.5)
  text(`DESDE ${joinedYear(me)}`, cw - P, 1082, `500 17px ${MONO}`, MUTED, 'right', 2.5)

  g.restore()
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('sin imagen'))), 'image/png'))

  // monograma de la organización (las imágenes externas no se dibujan para no bloquear el canvas)
  function drawOrg(o: Org, x: number, y: number, s: number) {
    const logo: { mark?: string; shape?: string } = o.logo && typeof o.logo === 'object' ? o.logo : {}
    const mark = logo.mark || initials(o.name)
    const shape = logo.shape || 'circle'
    g.save()
    g.translate(x, y)
    g.scale(s / 40, s / 40)
    g.beginPath()
    if (shape === 'square' || shape === 'squircle') rr(1, 1, 38, 38, shape === 'square' ? 7 : 14)
    else if (shape === 'hex') {
      ;([[20, 1], [37, 10.5], [37, 29.5], [20, 39], [3, 29.5], [3, 10.5]] as const).forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b)))
      g.closePath()
    } else if (shape === 'diamond') {
      g.translate(20, 20)
      g.rotate(Math.PI / 4)
      rr(-13, -13, 26, 26, 5)
      g.rotate(-Math.PI / 4)
      g.translate(-20, -20)
    } else g.arc(20, 20, shape === 'ring' ? 17.5 : 19, 0, Math.PI * 2)

    if (shape === 'ring') {
      g.lineWidth = 3
      g.strokeStyle = INK
      g.stroke()
    } else {
      g.fillStyle = INK
      g.fill()
    }
    const fs = [...mark].length > 1 ? (shape === 'diamond' ? 11 : 14) : 18
    g.font = `600 ${fs}px ${SANS}`
    g.fillStyle = shape === 'ring' ? INK : CARD
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(mark, 20, 21)
    g.restore()
  }
}
