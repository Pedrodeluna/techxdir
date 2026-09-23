// profile: read and update the caller's badge profile.
//
//   GET   /functions/v1/profile   → the caller's profile
//   PATCH /functions/v1/profile   → update name, handle, role, company, bio, photo_url
//
// The function runs as the caller (their JWT is forwarded), so row level
// security decides what it can read and write.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { validate } from './validate.ts'

const COLUMNS = 'id, name, handle, role, company, bio, photo_url, joined'

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return json({ error: 'Not signed in' }, 401)

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('profiles').select(COLUMNS).eq('id', user.id).single()
    if (error) return json({ error: 'Profile not found' }, 404)
    return json(data)
  }

  if (req.method === 'PATCH') {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Body must be valid JSON' }, 400)
    }
    const result = validate(body)
    if ('error' in result) return json({ error: result.error }, 400)

    const { data, error } = await supabase
      .from('profiles')
      .update(result.patch)
      .eq('id', user.id)
      .select(COLUMNS)
      .single()
    if (error?.code === '23505') return json({ error: 'That handle is already taken' }, 409)
    if (error) return json({ error: 'Could not save the profile' }, 500)
    return json(data)
  }

  return json({ error: 'Method not allowed' }, 405)
})
