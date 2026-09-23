import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { downloadBlob } from './lib/download'
import { renderCardImage } from './lib/shareImage'
import { shareText, type BadgeState } from './model'
import { useNotify } from './Toast'

/* Compartir en redes. El menú se abre hacia arriba, alineado a la izquierda del botón. */

type Kind = 'native' | 'x' | 'linkedin' | 'whatsapp' | 'copy' | 'image'

interface Props {
  open: boolean
  state: BadgeState
  anchorRef: RefObject<HTMLButtonElement | null>
  onClose: (focusBtn: boolean) => void
}

const shareUrl = () => `${location.origin}/`

export function ShareMenu({ open, state, anchorRef, onClose }: Props) {
  const notify = useNotify()
  const menuRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const blob = useRef<Blob | null>(null)
  const canNative = typeof navigator !== 'undefined' && 'share' in navigator
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
    setPreview(null)
    let url: string | null = null
    let alive = true
    renderCardImage(state)
      .then(b => {
        if (!alive) return
        blob.current = b
        url = URL.createObjectURL(b)
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

  async function share(kind: Kind) {
    const text = shareText(state)
    const url = shareUrl()
    const enc = encodeURIComponent
    const popup = (href: string) => window.open(href, '_blank', 'noopener,noreferrer,width=620,height=680')

    switch (kind) {
      case 'x':
        popup(`https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`)
        break
      case 'linkedin':
        popup(`https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`)
        break
      case 'whatsapp':
        popup(`https://wa.me/?text=${enc(`${text} ${url}`)}`)
        break
      case 'copy':
        try {
          await navigator.clipboard.writeText(`${text} ${url}`)
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
        const data: ShareData = { title: 'Mi acreditación · techxdir', text, url }
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
        {item('linkedin', 'LinkedIn', true)}
        {item('whatsapp', 'WhatsApp', true)}
        {item('copy', 'Copiar texto y enlace')}
        {item('image', 'Descargar imagen')}
      </div>
    </div>
  )
}
