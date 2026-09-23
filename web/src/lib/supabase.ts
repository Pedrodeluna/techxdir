import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** null when the env is missing: the app then runs in demo mode on sample data. */
export const supabase = url && anonKey ? createClient(url, anonKey) : null
export const isDemo = supabase === null
