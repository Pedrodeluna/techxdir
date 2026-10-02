/* Página pública de una acreditación: /acreditacion/<handle>?v=<versión> (ver vercel.json).

   Existe para las vistas previas de enlaces. X (y cualquier red o app de mensajería) no ejecuta
   JavaScript, así que no ve las etiquetas que pudiera poner la app: lee las og:/twitter: de este HTML, que
   apuntan a /acreditacion/<handle>/imagen.png, la imagen que la persona subió al compartir
   (badges/<id>.png) servida desde este dominio. Quien abre el enlace ve esa imagen y un botón
   para crear su acreditación.

   Usa las mismas variables que el build (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). */

const HANDLE = /^[A-Za-z0-9_]{1,15}$/
const VERSION = /^[0-9a-f]{1,64}$/
const BUCKET = 'badges' // el mismo que web/src/features/badge/lib/publishBadge.ts
const TIMEOUT_MS = 3000

export interface Badge {
  id: string
  name: string
  handle: string
  role: string
  company: string
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const home = new URL('/', url)
  // vercel.json lo pasa como ?handle= (y ?image para la imagen); si llega la ruta original, se lee de ella
  const path = url.pathname.match(/^\/acreditacion\/([^/]+?)(\/imagen\.png)?\/?$/)
  const handle = url.searchParams.get('handle') ?? path?.[1] ?? ''
  const wantsImage = url.searchParams.has('image') || Boolean(path?.[2])
  const version = url.searchParams.get('v') ?? ''
  const api = process.env.VITE_SUPABASE_URL?.replace(/\/+$/, '')
  const key = process.env.VITE_SUPABASE_ANON_KEY
  const notFound = () => (wantsImage ? new Response('Not found', { status: 404 }) : Response.redirect(home, 302))
  if (!api || !key || !HANDLE.test(handle)) return notFound()

  const badge = await findBadge(api, key, handle).catch(() => null)
  if (!badge) return notFound()

  const v = VERSION.test(version) ? version : ''
  const stored = `${api}/storage/v1/object/public/${BUCKET}/${badge.id}.png${v ? `?v=${v}` : ''}`
  if (wantsImage) return serveImage(stored)

  // quien no ha compartido aún no tiene imagen: la página sale igual, sin ella
  const hasImage = await fetch(stored, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) }).then(r => r.ok, () => false)
  // la imagen se sirve desde este dominio: Storage la manda con X-Robots-Tag: none, que los
  // lectores de tarjetas pueden tomar como prohibición de usarla
  const imageUrl = new URL(`/acreditacion/${badge.handle}/imagen.png`, url)
  if (v) imageUrl.searchParams.set('v', v)

  const pageUrl = new URL(`/acreditacion/${badge.handle}`, url)
  if (v) pageUrl.searchParams.set('v', v)

  return new Response(badgePage({ badge, pageUrl: pageUrl.href, homeUrl: home.href, imageUrl: hasImage ? imageUrl.href : null }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // la versión va en el enlace: cada imagen nueva tiene su propia URL
      'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600',
    },
  })
}

// El archivo se sustituye al compartir de nuevo: incluso con versión, la caché debe revalidarse.
async function serveImage(stored: string): Promise<Response> {
  const res = await fetch(stored, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null)
  if (!res?.ok) return new Response('Not found', { status: 404 })
  return new Response(await res.arrayBuffer(), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=0, s-maxage=60',
    },
  })
}

// El handle se guarda con sus mayúsculas y es único sin distinguirlas (profiles_handle_key).
async function findBadge(api: string, key: string, handle: string): Promise<Badge | null> {
  const pattern = encodeURIComponent(handle.replaceAll('_', '\\_')) // en ilike, _ es comodín
  const res = await fetch(`${api}/rest/v1/profiles?select=id,name,handle,role,company&handle=ilike.${pattern}&limit=1`, {
    headers: { apikey: key, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return null
  const [row] = (await res.json()) as Badge[]
  return row ?? null
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string) => s.replace(/[&<>"']/g, c => ENTITIES[c])

export function badgePage({ badge, pageUrl, homeUrl, imageUrl }: {
  badge: Badge
  pageUrl: string
  homeUrl: string
  imageUrl: string | null
}): string {
  const name = badge.name.trim() || `@${badge.handle}`
  const title = `${name} · techxdir`
  const role = [badge.role, badge.company].map(s => s.trim()).filter(Boolean).join(' · ')
  const description = `Acreditación de ${name} en techxdir: los eventos tech a los que va y las personas con las que ha coincidido.`
  const alt = `Acreditación de ${name} en techxdir`

  const image = imageUrl
    ? `
    <meta property="og:image" content="${esc(imageUrl)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(alt)}" />
    <meta name="twitter:image" content="${esc(imageUrl)}" />
    <meta name="twitter:image:alt" content="${esc(alt)}" />`
    : ''

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${esc(pageUrl)}" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta property="og:type" content="profile" />
    <meta property="og:site_name" content="techxdir" />
    <meta property="og:locale" content="es_ES" />
    <meta property="og:url" content="${esc(pageUrl)}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="profile:username" content="${esc(badge.handle)}" />
    <meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:creator" content="@${esc(badge.handle)}" />${image}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet" />
    <style>
      :root { --bg: #ebeae6; --card: #fbfbf9; --ink: #111113; --muted-text: #636268; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 32px 16px;
        background: var(--bg); color: var(--ink); font-family: 'Space Grotesk', system-ui, sans-serif; }
      main { width: min(720px, 100%); display: grid; gap: 20px; text-align: center; justify-items: center; }
      img { width: min(440px, 100%); height: auto; aspect-ratio: 6 / 7; object-fit: cover; display: block; }
      .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }
      .download { display: inline-block; padding: 14px 22px; color: var(--ink); text-underline-offset: 4px; }
      .note { font-size: 13px; line-height: 1.5; }
      h1 { margin: 0; font-size: clamp(28px, 6vw, 40px); font-weight: 500; letter-spacing: -.02em; }
      p { margin: 0; color: var(--muted-text); }
      .handle { font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--ink); text-decoration: none; }
      .handle:hover { text-decoration: underline; }
      .cta { display: inline-block; margin-top: 8px; padding: 14px 22px; border-radius: 999px;
        background: var(--ink); color: var(--card); font-weight: 500; text-decoration: none; }
      .download:focus-visible, .cta:focus-visible, .handle:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
    </style>
  </head>
  <body>
    <main>
      ${imageUrl ? `<img src="${esc(imageUrl)}" width="1200" height="630" alt="${esc(alt)}" />` : ''}
      <div>
        <h1>${esc(name)}</h1>
        ${role ? `<p>${esc(role)}</p>` : ''}
        <p><a class="handle" href="https://x.com/${esc(badge.handle)}" rel="noopener">@${esc(badge.handle)}</a></p>
      </div>
      ${imageUrl ? `<div class="actions"><a class="download" href="${esc(imageUrl)}" download="techxdir-${esc(badge.handle)}.png">Descargar imagen</a><a class="download" href="${esc(imageUrl)}">Ver imagen completa</a></div>` : '<p class="note">Esta persona todavía no ha publicado la imagen de su tarjeta.</p>'}
      <a class="cta" href="${esc(homeUrl)}">Crea tu acreditación en techxdir</a>
    </main>
  </body>
</html>
`
}
