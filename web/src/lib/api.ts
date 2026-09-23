import { supabase } from './supabase'

/* Client for the `profile` edge function (supabase/functions/profile). */

export interface Profile {
  id: string
  name: string
  handle: string | null
  role: string
  company: string
  bio: string
  photo_url: string | null
  joined: number
}

export type ProfilePatch = Partial<Pick<Profile, 'name' | 'handle' | 'role' | 'company' | 'bio' | 'photo_url'>>

export async function getProfile(): Promise<Profile> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.functions.invoke<Profile>('profile', { method: 'GET' })
  if (error) throw error
  return data!
}

export async function updateProfile(patch: ProfilePatch): Promise<Profile> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.functions.invoke<Profile>('profile', { method: 'PATCH', body: patch })
  if (error) throw error
  return data!
}
