// Input rules for PATCH /profile. They mirror the checks in the migration.

const LIMITS = { name: 40, role: 40, company: 30, bio: 160 } as const
const HANDLE = /^[A-Za-z0-9_]{1,15}$/

type Patch = Partial<Record<'name' | 'handle' | 'role' | 'company' | 'bio' | 'photo_url', string | null>>

/** Returns the clean patch, or an error message for the first invalid field. */
export function validate(input: unknown): { patch: Patch } | { error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Body must be a JSON object' }
  const body = input as Record<string, unknown>
  const patch: Patch = {}

  for (const [key, max] of Object.entries(LIMITS)) {
    if (!(key in body)) continue
    const value = body[key]
    if (typeof value !== 'string') return { error: `${key} must be a string` }
    const clean = value.trim()
    if (clean.length > max) return { error: `${key} is longer than ${max} characters` }
    if (key === 'name' && !clean) return { error: 'name cannot be empty' }
    patch[key as keyof typeof LIMITS] = clean
  }

  if ('handle' in body) {
    const handle = typeof body.handle === 'string' ? body.handle.trim().replace(/^@/, '') : ''
    if (!HANDLE.test(handle)) return { error: 'handle must be 1-15 letters, digits or underscores' }
    patch.handle = handle
  }

  if ('photo_url' in body) {
    const url = body.photo_url
    if (url !== null && (typeof url !== 'string' || !url.startsWith('https://'))) {
      return { error: 'photo_url must be an https URL or null' }
    }
    patch.photo_url = url
  }

  if (!Object.keys(patch).length) return { error: 'Nothing to update' }
  return { patch }
}
