// Approximate city centres, not venue addresses. Unknown/online cities stay in the list.
const CITIES: Record<string, [number, number]> = {
  madrid: [-3.704, 40.417], barcelona: [2.174, 41.385], alicante: [-0.49, 38.345],
  caceres: [-6.371, 39.476], torremolinos: [-4.5, 36.621], malaga: [-4.421, 36.721],
  aranjuez: [-3.603, 40.033], valencia: [-0.376, 39.47], bilbao: [-2.935, 43.263],
  sevilla: [-5.984, 37.389], logrono: [-2.445, 42.466], leganes: [-3.765, 40.328],
  tenerife: [-16.251, 28.463], 'las palmas': [-15.436, 28.124], zaragoza: [-0.89, 41.649],
}
export function cityPoint(city: string) {
  const key = city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  const point = CITIES[key]
  if (!point) return null
  const [lon, lat] = point
  const [x, y] = lat < 32 ? [90 + (lon + 18.5) * 33, 485 + (29.7 - lat) * 33] : [80 + (lon + 10) * 43, 85 + (44.5 - lat) * 47]
  return { x: x - y * .16 + 60, y: x * .08 + y * .82 + 12 }
}
