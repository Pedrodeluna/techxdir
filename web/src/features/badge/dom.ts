import type { CSSProperties } from 'react'

/** Vuelve a lanzar una animación CSS quitando y poniendo la clase. */
export function replay(el: Element | null | undefined, cls: string) {
  if (!el) return
  el.classList.remove(cls)
  void (el as HTMLElement).offsetWidth
  el.classList.add(cls)
}

export function focusQuiet(el: Element | null | undefined) {
  ;(el as HTMLElement | null)?.focus({ preventScroll: true })
}

/** Índice de escalonado para las animaciones de entrada (`--i` en el CSS) */
export const at = (i: number) => ({ '--i': i }) as CSSProperties
