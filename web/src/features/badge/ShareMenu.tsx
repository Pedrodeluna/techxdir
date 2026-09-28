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

type Kind = 'native' | 'x' | 'copy' | 'image'

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
  const version = useRef<string | null>(null)
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
    ;(menuRef.current?.querySelector('[data-share]:not([hidden])') as HTMLElement | null)?.focus({ preventScroll: true })
    blob.current = null
    version.current = null
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
        version.current = r.version
        url = URL.createObjectURL(r.card)
        setPreview(url)
      })
      .catch(() => { /* sin vista previa: el resto de opciones sigue funcionando */ })
    return () => {
      alive = false
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
        const items = [...menuRef.current!.querySelectorAll<HTMLElement>('[data-share]:not([hidden])')]
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

  // Sube la imagen del enlace (una vez por versión) y devuelve el enlace a compartir.
  // Sin sesión, o si la subida falla, se comparte la portada.
  function publish(): Promise<string> {
    if (!canPublish || !images.current) return Promise.resolve(homeUrl())
    published.current ??= images.current
      .then(async ({ link, version: v }) => {
        if (uploaded.current !== v) {
          await uploadBadgeImage(userId!, link)
          uploaded.current = v
        }
        return badgeLink(state.me.handle, v)
      })
      .catch(() => homeUrl())
    return published.current
  }

  // Enlace sin esperar a la subida, para lo que tiene que ocurrir en el mismo clic (portapapeles,
  // hoja de compartir del sistema). La subida sigue en segundo plano; quien lo abra llega después.
  function linkNow(): string {
    if (!canPublish || !version.current) return homeUrl()
    void publish()
    return badgeLink(state.me.handle, version.current)
  }

  // La ventana se abre en el clic (si no, el navegador la bloquea) y navega cuando la imagen
  // ya está subida: X lee la vista previa nada más cargar.
  async function popup(href: (url: string) => string) {
    const win = window.open('', '_blank', 'width=620,height=680')
    if (win) {
      win.opener = null
      win.document.title = 'techxdir'
      win.document.body.textContent = 'Preparando tu acreditación…'
    }
    const target = href(await publish())
    if (win) win.location.href = target
    else window.open(target, '_blank', 'noopener,noreferrer,width=620,height=680')
  }

  async function share(kind: Kind) {
    const text = shareText(state)
    const enc = encodeURIComponent

    switch (kind) {
      case 'x':
        await popup(url => `https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`)
        break
      case 'copy':
        try {
          await navigator.clipboard.writeText(`${text} ${linkNow()}`)
          notify('Texto y enlace copiados')
        } catch {
          notify('No se ha podido copiar')
        }
        break
      case 'image':
        downloadBlob(blob.current || await renderCardImage(state), fileName)
        notify('Imagen descargada')
        break
      case 'native': {
        const data: ShareData = { title: 'Mi acreditación · techxdir', text, url: linkNow() }
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
      hidden={kind === 'native' && !canNative}
      onClick={() => { share(kind); onClose(true) }}>{label}</button>
  )

  return (
    <div className="share">
      <div className="share-menu" id="shareMenu" role="menu" aria-label="Compartir acreditación" hidden={!open} ref={menuRef}>
        <img className="share-preview" src={preview ?? undefined} alt="Vista previa de la imagen de tu acreditación" onLoad={place} />
        {item('native', 'Compartir…')}
        {item('x', 'Publicar en X', true)}
        {item('copy', 'Copiar texto y enlace')}
        {item('image', 'Descargar imagen')}
      </div>
    </div>
  )
}
