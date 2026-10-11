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
}
const ISLAND_NAMES: Record<string, string> = {
  palma: 'Mallorca', ibiza: 'Ibiza', mahon: 'Menorca',
  tenerife: 'Tenerife', 'santa cruz de tenerife': 'Tenerife',
  'las palmas': 'Gran Canaria', 'las palmas de gran canaria': 'Gran Canaria',
  arrecife: 'Lanzarote', 'puerto del rosario': 'Fuerteventura',
}

// Only labels are offset. Pins stay at the projected city coordinates.
const MARKER_LAYOUT: Record<string, {
  text: { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }
}> = {
  'a coruna': { text: { dx: 25, dy: -25, anchor: 'start' } },
  'santiago de compostela': { text: { dx: 29, dy: -17, anchor: 'start' } },
  vigo: { text: { dx: -23, dy: -20, anchor: 'end' } },
  sevilla: { text: { dx: -24, dy: -24, anchor: 'end' } },
  cadiz: { text: { dx: -24, dy: -15, anchor: 'end' } },
  malaga: { text: { dx: 14, dy: 22, anchor: 'start' } },
  granada: { text: { dx: 24, dy: -30, anchor: 'start' } },
}

export function cityPoint(city: string) {
  const key = city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  const point = CITIES[key]
  if (!point) return null
  const [lon, lat] = point
  let [x, y] = lat < 32 ? [90 + (lon + 18.5) * 33, 485 + (29.7 - lat) * 33] : [80 + (lon + 10) * 43, 85 + (44.5 - lat) * 47]
  const region = lat < 32 ? 'canarias' : lon > 1 && lat < 40.1 ? 'baleares' : 'peninsula'
  if (region === 'peninsula') { x = x * PENINSULA_SCALE + PENINSULA_OFFSET.x; y = y * PENINSULA_SCALE + PENINSULA_OFFSET.y }
  const layout = MARKER_LAYOUT[key]
  return {
    x: x - y * .16 + 60,
    y: x * .08 + y * .82 + 12,
    region, label: ISLAND_NAMES[key] ?? city, text: layout?.text,
  }
}
