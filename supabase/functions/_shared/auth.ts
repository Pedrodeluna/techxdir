// Who is calling an ingestion function: the scheduler (x-cron-secret), an
// admin, a manager of the given organization, or nobody allowed.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type Caller =
  | { kind: 'cron' }
  | { kind: 'admin'; userId: string }
  | { kind: 'manager'; userId: string; orgs: string[] }

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Compares two strings in constant time. */
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

export async function authorize(req: Request, db: SupabaseClient): Promise<Caller | null> {
  const secret = Deno.env.get('CRON_SECRET')
  const given = req.headers.get('x-cron-secret')
  if (secret && given && sameSecret(given, secret)) return { kind: 'cron' }

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data: { user } } = await db.auth.getUser(token)
  if (!user) return null

  const [admin, banned, managed] = await Promise.all([
    db.from('app_admins').select('profile_id').eq('profile_id', user.id).maybeSingle(),
    db.from('bans').select('profile_id').eq('profile_id', user.id).maybeSingle(),
    db.from('org_managers').select('org_id').eq('profile_id', user.id),
  ])
  if (banned.data) return null
  if (admin.data) return { kind: 'admin', userId: user.id }
  const orgs = (managed.data ?? []).map(row => row.org_id as string)
  return orgs.length ? { kind: 'manager', userId: user.id, orgs } : null
}

export const canManage = (caller: Caller, orgId: string) =>
  caller.kind !== 'manager' || caller.orgs.includes(orgId)

export const userIdOf = (caller: Caller) => caller.kind === 'cron' ? null : caller.userId
