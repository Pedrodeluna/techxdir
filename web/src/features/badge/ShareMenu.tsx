import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useAuth } from '../../lib/auth-context'
import { downloadBlob } from './lib/download'
import { badgeLink, imageVersion, uploadBadgeImage } from './lib/publishBadge'
import { renderCardImage, renderShareImages } from './lib/shareImage'
import { shareText, type BadgeState } from './model'
import { useNotify } from './Toast'

/* Compartir en redes. El menú se abre hacia arriba, alineado a la izquierda del botón.
   Con sesión, el enlace es /acreditacion/<handle>: al compartirlo se sube la imagen y
   las redes la muestran en la vista previa. La acreditación de ejemplo comparte la portada. */

type Kind = 'native' | 'x' | 'copy' | 'image' | 'view'

interface Props {
  open: boolean
  state: BadgeState
  anchorRef: RefObject<HTMLButtonElement | null>
  onClose: (focusBtn: boolean) => void
}

interface Images {
  card: Blob
  link: Blob
  version: string
}

const homeUrl = () => `${location.origin}/`

export function ShareMenu({ open, state, anchorRef, onClose }: Props) {
  const notify = useNotify()
  const userId = useAuth().session?.user.id
  const menuRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const blob = useRef<Blob | null>(null)
  const images = useRef<Promise<Images> | null>(null)
  const [readyUrl, setReadyUrl] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const published = useRef<Promise<string> | null>(null)
  const uploaded = useRef<string | null>(null) // versión ya subida: no se repite en la siguiente apertura
  const canNative = typeof navigator !== 'undefined' && 'share' in navigator
  const canPublish = Boolean(state.live && userId && state.me.handle)
  const fileName = `techxdir-${state.me.handle || 'acreditacion'}.png`

  const place = useCallback(() => {
    const menu = menuRef.current
    const btn = anchorRef.current
    if (!menu || !btn || menu.hidden) return
    const r = btn.getBoundingClientRect()
    const left = Math.min(Math.max(12, r.left), innerWidth - menu.offsetWidth - 12)
    const top = Math.max(12, r.top - menu.offsetHeight - 10)
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }, [anchorRef])

  // al abrir: enfoca la primera opción y regenera la imagen con los últimos cambios
  useLayoutEffect(() => {
    if (!open) return
    place()
    ;(menuRef.current?.querySelector('[data-share]:not([hidden]):not(:disabled)') as HTMLElement | null)?.focus({ preventScroll: true })
    blob.current = null
    generation.current += 1
    setReadyUrl(null)
    setPreparing(false)
    setError(null)
    published.current = null
    setPreview(null)
    let url: string | null = null
    let alive = true
    const job = renderShareImages(state).then(async ({ card, link }) => ({ card, link, version: await imageVersion(link) }))
    images.current = job
    job
      .then(r => {
        if (!alive) return
        blob.current = r.card
        url = URL.createObjectURL(r.card)
        setPreview(url)
      })
      .catch(() => { if (alive) setError('No se ha podido generar la vista previa. Prueba a abrir de nuevo este menú.') })
    return () => {
      alive = false
      generation.current += 1
      if (url) URL.revokeObjectURL(url)
    }
    // la imagen se genera una vez por apertura
  }, [open])

  // fuera del menú, el primer clic solo lo cierra; Esc también, y las flechas recorren las opciones
  useEffect(() => {
    if (!open) return
    const onClick = (ev: MouseEvent) => {
      if ((ev.target as Element).closest('.share')) return
      onClose(false)
      ev.stopPropagation()
      ev.preventDefault()
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        onClose(true)
        ev.stopPropagation()
        return
      }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        const items = [...menuRef.current!.querySelectorAll<HTMLElement>('[data-share]:not([hidden]):not(:disabled)')]
        if (!items.length) return
        const i = items.indexOf(document.activeElement as HTMLElement)
        items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus()
        ev.preventDefault()
      }
    }
    addEventListener('resize', place)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      removeEventListener('resize', place)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose, place])

  // Publica únicamente al pulsar Preparar enlace. No se entrega una URL hasta que
  // Storage confirma la subida; un fallo deja reintentar sin compartir la portada.
  async function prepare() {
    if (!canPublish || !images.current || preparing) return
    const current = generation.current
    setPreparing(true)
    setError(null)
    try {
      published.current ??= images.current.then(async ({ link, version: v }) => {
        if (uploaded.current !== v) {
          await uploadBadgeImage(userId!, link)
          uploaded.current = v
        }
        return badgeLink(state.me.handle, v)
      })
      const url = await published.current
      if (current === generation.current) setReadyUrl(url)
    } catch {
      if (current === generation.current) {
        published.current = null
        setError('No se ha podido preparar el enlace. Vuelve a intentarlo.')
      }
    } finally {
      if (current === generation.current) setPreparing(false)
    }
  }

  useLayoutEffect(() => { if (open) place() }, [open, readyUrl, preparing, error, place])
  useEffect(() => {
    if (open && readyUrl) menuRef.current?.querySelector<HTMLButtonElement>('[data-share="view"]')?.focus({ preventScroll: true })
  }, [open, readyUrl])

  async function share(kind: Kind) {
    const text = shareText(state)
    const url = canPublish ? readyUrl : homeUrl()
    if (kind !== 'image' && !url) return
    const enc = encodeURIComponent

    switch (kind) {
      case 'view':
        window.open(url!, '_blank', 'noopener,noreferrer')
        break
      case 'x':
        window.open(`https://x.com/intent/post?text=${enc(text)}&url=${enc(url!)}`, '_blank', 'noopener,noreferrer,width=620,height=680')
        break
      case 'copy':
        try {
          await navigator.clipboard.writeText(url!)
          notify('Enlace de la tarjeta copiado')
        } catch {
          notify('No se ha podido copiar')
        }
        break
      case 'image':
        downloadBlob(blob.current || await renderCardImage(state), fileName)
        notify('Imagen descargada')
        break
      case 'native': {
        const data: ShareData = { title: 'Mi acreditación · techxdir', text, url: url! }
        if (blob.current) {
          const file = new File([blob.current], fileName, { type: 'image/png' })
          if (navigator.canShare?.({ files: [file] })) data.files = [file]
        }
        try {
          await navigator.share(data)
        } catch (err) {
          if ((err as Error).name !== 'AbortError') notify('No se ha podido compartir')
        }
        break
      }
    }
  }

  const item = (kind: Kind, label: string, ext = false) => (
    <button type="button" role="menuitem" data-share={kind} className={ext ? 'ext' : undefined}
      disabled={kind !== 'image' && canPublish && !readyUrl}
      hidden={(kind === 'native' && !canNative) || (kind === 'view' && !canPublish)}
      onClick={() => { void share(kind).catch(() => notify('No se ha podido compartir. Inténtalo de nuevo.')); onClose(true) }}>{label}</button>
  )

  return (
    <div className="share">
      <div className="share-menu" id="shareMenu" role="menu" aria-label="Compartir acreditación" hidden={!open} ref={menuRef}>
        <img className="share-preview" src={preview ?? undefined} alt="Vista previa de la imagen de tu acreditación" onLoad={place} />
        <p className="share-status" role="status">{error || (canPublish
          ? readyUrl ? 'Tu tarjeta está lista. Cualquiera con el enlace puede verla.' : 'Publica esta imagen para compartir tu tarjeta con un enlace.'
          : 'Tarjeta de ejemplo. Puedes descargar la imagen; el enlace lleva a techxdir.')}</p>
        {canPublish && !readyUrl && <button type="button" role="menuitem" data-share="prepare" disabled={preparing || !preview} onClick={() => void prepare()}>
          {preparing ? 'Preparando enlace…' : 'Preparar enlace'}
        </button>}
        {item('view', 'Ver tarjeta pública', true)}
        {item('native', 'Compartir…')}
        {item('x', 'Publicar en X', true)}
        {item('copy', 'Copiar enlace')}
        {item('image', 'Descargar imagen')}
      </div>
    </div>
  )
}
