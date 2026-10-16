export const PENINSULA_OFFSET = { x: -52, y: -65 }
export const PENINSULA_SCALE = 1.06

// Approximate city centres, not venue addresses. Unknown/online cities stay in the list.
const CITIES: Record<string, [number, number]> = {
  palma: [2.65, 39.57], ibiza: [1.43, 38.91], mahon: [4.27, 39.89],
  'santa cruz de tenerife': [-16.251, 28.463],
  'las palmas de gran canaria': [-15.436, 28.124],
  arrecife: [-13.55, 28.96], 'puerto del rosario': [-13.86, 28.5],
  granada: [-3.599, 37.177], cadiz: [-6.288, 36.527],
  'a coruna': [-8.411, 43.362], vigo: [-8.72, 42.24], 'santiago de compostela': [-8.544, 42.881],
  madrid: [-3.704, 40.417], barcelona: [2.174, 41.385], alicante: [-0.49, 38.345],
  caceres: [-6.371, 39.476], torremolinos: [-4.5, 36.621], malaga: [-4.421, 36.721],
  aranjuez: [-3.603, 40.033], valencia: [-0.376, 39.47], bilbao: [-2.935, 43.263],
  sevilla: [-5.984, 37.389], logrono: [-2.445, 42.466], leganes: [-3.765, 40.328],
  tenerife: [-16.251, 28.463], 'las palmas': [-15.436, 28.124], zaragoza: [-0.89, 41.649],
  // Every city the ingest recognizes (supabase/functions/_shared/cities.ts), plus catalog ones.
  murcia: [-1.131, 37.992], valladolid: [-4.724, 41.652], 'san sebastian': [-1.984, 43.318],
  pamplona: [-1.645, 42.812], oviedo: [-5.846, 43.361], gijon: [-5.661, 43.545],
  santander: [-3.81, 43.462], cordoba: [-4.779, 37.888], salamanca: [-5.664, 40.965],
  castellon: [-0.051, 39.986], girona: [2.821, 41.979], tarragona: [1.245, 41.119],
  vitoria: [-2.672, 42.846], leon: [-5.567, 42.599], lleida: [0.62, 41.614],
  segovia: [-4.118, 40.948], toledo: [-4.027, 39.863], 'jerez de la frontera': [-6.137, 36.686],
  'san vicente del raspeig': [-0.525, 38.396], ourense: [-7.864, 42.336],
}
const ISLAND_NAMES: Record<string, string> = {
  palma: 'Mallorca', ibiza: 'Ibiza', mahon: 'Menorca',
  tenerife: 'Tenerife', 'santa cruz de tenerife': 'Tenerife',
  'las palmas': 'Gran Canaria', 'las palmas de gran canaria': 'Gran Canaria',
  arrecife: 'Lanzarote', 'puerto del rosario': 'Fuerteventura',
}

// Bases stay at the projected city coordinates. Nearby pin heads fan out,
// and their labels move with them, only when the neighbor is on the map too.
type Label = { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }
const MARKER_LAYOUT: Record<string, {
  text?: Label
  head?: { dx: number; dy: number; neighbor: string; text?: Label }
}> = {
  'a coruna': { text: { dx: 25, dy: -25, anchor: 'start' },
    head: { dx: -44, dy: -36, neighbor: 'santiago de compostela', text: { dx: -66, dy: -30, anchor: 'end' } } },
  ourense: { head: { dx: 18, dy: -8, neighbor: 'santiago de compostela', text: { dx: 40, dy: -2, anchor: 'start' } } },
  'santiago de compostela': { text: { dx: 29, dy: -17, anchor: 'start' } },
  vigo: { text: { dx: -23, dy: -20, anchor: 'end' } },
  sevilla: { text: { dx: -24, dy: -24, anchor: 'end' } },
  cadiz: { text: { dx: -24, dy: -15, anchor: 'end' },
    head: { dx: -26, dy: -30, neighbor: 'jerez de la frontera', text: { dx: -48, dy: -22, anchor: 'end' } } },
  'jerez de la frontera': {
    head: { dx: -14, dy: 28, neighbor: 'torremolinos', text: { dx: -36, dy: 36, anchor: 'end' } } },
  torremolinos: { text: { dx: -48, dy: -30, anchor: 'end' }, head: { dx: -26, dy: -34, neighbor: 'malaga' } },
  malaga: { text: { dx: 48, dy: -30, anchor: 'start' }, head: { dx: 26, dy: -34, neighbor: 'torremolinos' } },
  granada: { text: { dx: 24, dy: -30, anchor: 'start' } },
  oviedo: { head: { dx: -26, dy: -30, neighbor: 'gijon', text: { dx: -48, dy: -22, anchor: 'end' } } },
  gijon: { head: { dx: 26, dy: -34, neighbor: 'oviedo', text: { dx: 48, dy: -30, anchor: 'start' } } },
  segovia: { head: { dx: -22, dy: -30, neighbor: 'madrid', text: { dx: -44, dy: -24, anchor: 'end' } } },
  toledo: { head: { dx: -20, dy: -14, neighbor: 'madrid', text: { dx: -42, dy: -8, anchor: 'end' } } },
  murcia: { text: { dx: -25, dy: -24, anchor: 'end' } },
  alicante: { head: { dx: 26, dy: -30, neighbor: 'san vicente del raspeig', text: { dx: 48, dy: -26, anchor: 'start' } } },
  'san vicente del raspeig': { head: { dx: 0, dy: 26, neighbor: 'alicante', text: { dx: 18, dy: 30, anchor: 'start' } } },
  zaragoza: { head: { dx: 0, dy: -24, neighbor: 'lleida', text: { dx: -25, dy: -24, anchor: 'end' } } },
  barcelona: { head: { dx: 0, dy: -24, neighbor: 'lleida', text: { dx: 22, dy: -20, anchor: 'start' } } },
}

export function cityPoint(city: string, visibleCities: readonly string[] = []) {
  const key = city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  const point = CITIES[key]
  if (!point) return null
  const [lon, lat] = point
  let [x, y] = lat < 32 ? [90 + (lon + 18.5) * 33, 485 + (29.7 - lat) * 33] : [80 + (lon + 10) * 43, 85 + (44.5 - lat) * 47]
  const region = lat < 32 ? 'canarias' : lon > 1 && lat < 40.1 ? 'baleares' : 'peninsula'
  if (region === 'peninsula') { x = x * PENINSULA_SCALE + PENINSULA_OFFSET.x; y = y * PENINSULA_SCALE + PENINSULA_OFFSET.y }
  const layout = MARKER_LAYOUT[key]
  const projected = { x: x - y * .16 + 60, y: x * .08 + y * .82 + 12 }
  const headOffset = layout?.head
  const crowded = headOffset && visibleCities.some(name =>
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === headOffset.neighbor,
  )
  return {
    ...projected,
    head: { x: projected.x + (crowded ? headOffset.dx : 0), y: projected.y + (crowded ? headOffset.dy : -24) },
    region, label: ISLAND_NAMES[key] ?? city, text: (crowded && headOffset.text) || layout?.text,
  }
}
