// Canonical names of the Spanish cities the app groups events by, so that
// "Barcelona, Catalunya", "BCN" and "barcelona" end up as one city.
const CITIES: Record<string, string[]> = {
  'Madrid': ['madrid'],
  'Barcelona': ['barcelona', 'bcn'],
  'Valencia': ['valencia', 'valència'],
  'Sevilla': ['sevilla', 'seville'],
  'Málaga': ['malaga', 'málaga'],
  'Bilbao': ['bilbao', 'bilbo'],
  'Zaragoza': ['zaragoza'],
  'Alicante': ['alicante', 'alacant'],
  'Granada': ['granada'],
  'A Coruña': ['a coruña', 'a coruna', 'la coruña', 'coruña'],
  'Vigo': ['vigo'],
  'Valladolid': ['valladolid'],
  'Murcia': ['murcia'],
  'Palma': ['palma', 'palma de mallorca'],
  'Las Palmas': ['las palmas', 'las palmas de gran canaria'],
  'Santa Cruz de Tenerife': ['santa cruz de tenerife', 'tenerife'],
  'San Sebastián': ['san sebastián', 'san sebastian', 'donostia', 'donostia-san sebastián'],
  'Pamplona': ['pamplona', 'iruña'],
  'Oviedo': ['oviedo'],
  'Gijón': ['gijón', 'gijon'],
  'Santander': ['santander'],
  'Córdoba': ['córdoba', 'cordoba'],
  'Salamanca': ['salamanca'],
  'Logroño': ['logroño', 'logrono'],
  'Castellón': ['castellón', 'castellon', 'castelló', 'castellón de la plana'],
  'Girona': ['girona', 'gerona'],
  'Tarragona': ['tarragona'],
  'Cádiz': ['cádiz', 'cadiz'],
  'Vitoria': ['vitoria', 'vitoria-gasteiz', 'gasteiz'],
  'León': ['león', 'leon'],
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

const BY_ALIAS = new Map<string, string>()
for (const [name, aliases] of Object.entries(CITIES)) {
  for (const alias of aliases) BY_ALIAS.set(fold(alias), name)
}

/** The canonical city for a raw value such as "Barcelona, Catalunya". */
export function normalizeCity(raw: string | null | undefined): string | null {
  if (!raw) return null
  const first = raw.split(',')[0].trim()
  if (!first) return null
  return BY_ALIAS.get(fold(first)) ?? BY_ALIAS.get(fold(raw)) ?? first
}

/** The first known city that appears in free text, such as an iCal LOCATION. */
export function cityFromText(text: string | null | undefined): string | null {
  if (!text) return null
  const parts = text.split(',').map(part => fold(part)).filter(Boolean)
  // Addresses end with the city, so read them backwards.
  for (const part of parts.reverse()) {
    const clean = part.replace(/^\d{5}\s+/, '')
    const hit = BY_ALIAS.get(clean)
    if (hit) return hit
  }
  return null
}
