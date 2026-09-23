/** X OAuth supplies a small `_normal` avatar. The unsuffixed CDN URL is full size. */
export function xProfilePhoto(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'pbs.twimg.com') return url
    if (!/^\/profile_images\/\d+\/[^/]+_normal\.(?:jpe?g|png|webp)$/i.test(parsed.pathname)) return url
    parsed.pathname = parsed.pathname.replace(/_normal(?=\.(?:jpe?g|png|webp)$)/i, '')
    return parsed.toString()
  } catch {
    return url
  }
}
