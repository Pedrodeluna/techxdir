import { supabase } from '../../../lib/supabase'

/* Enlace con vista previa. X no ejecuta JavaScript: lee las etiquetas
   og:/twitter: de /acreditacion/<handle> (web/api/badge.ts), que apuntan a la imagen que
   se sube aquí al compartir. */

const BUCKET = 'badges' // el mismo que web/api/badge.ts y la migración badge_images

/** Huella corta de la imagen. Va en el enlace: si la acreditación cambia, cambia el enlace y X vuelve a leer la imagen. */
export async function imageVersion(blob: Blob): Promise<string> {
  // crypto.subtle solo existe en https o localhost; fuera de ahí, una versión nueva cada vez
  if (!crypto.subtle) return Date.now().toString(16)
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest).slice(0, 6)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export const badgeLink = (handle: string, version: string) =>
  `${location.origin}/acreditacion/${encodeURIComponent(handle)}?v=${version}`

/** Sube (o sustituye) badges/<userId>.png, pública. */
export async function uploadBadgeImage(userId: string, image: Blob) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${userId}.png`, image, { upsert: true, contentType: 'image/png', cacheControl: '60' })
  if (error) throw error
}
