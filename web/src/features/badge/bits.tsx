import type { CSSProperties, ReactElement } from 'react'
import type { Org, OrgShape } from '../../data/sample'
import { avatarLightness, initials } from './model'

/* Piezas pequeñas que se repiten en la acreditación y en el panel */

export function Avatar({ name }: { name: string }) {
  return (
    <span className="av" style={{ '--l': `${avatarLightness(name)}%` } as CSSProperties} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

export function Photo({ photo, name }: { photo: string | null; name: string }) {
  return photo
    ? <img src={photo} alt={`Foto de ${name}`} />
    : <span className="initials" aria-hidden="true">{initials(name)}</span>
}

const ORG_SHAPES: Record<OrgShape, ReactElement> = {
  circle: <circle cx="20" cy="20" r="19" />,
  square: <rect x="1" y="1" width="38" height="38" rx="7" />,
  squircle: <rect x="1" y="1" width="38" height="38" rx="14" />,
  hex: <polygon points="20,1 37,10.5 37,29.5 20,39 3,29.5 3,10.5" />,
  diamond: <rect x="7" y="7" width="26" height="26" rx="5" transform="rotate(45 20 20)" />,
  ring: <circle cx="20" cy="20" r="17.5" fill="none" stroke="currentColor" strokeWidth="3" />,
}

// Logotipo: una imagen si `logo` es una URL, si no un monograma en SVG
export function OrgLogo({ org, size = '' }: { org: Org | undefined; size?: '' | 'xs' | 'sm' | 'xl' }) {
  if (!org) return null
  if (typeof org.logo === 'string') {
    return <img className={`org-logo ${size}`} src={org.logo} alt={org.name} />
  }
  const mark = org.logo.mark || initials(org.name)
  const shape = ORG_SHAPES[org.logo.shape] ? org.logo.shape : 'circle'
  const fontSize = [...mark].length > 1 ? (shape === 'diamond' ? 11 : 14) : 18
  return (
    <svg className={`org-logo is-${shape} ${size}`} viewBox="0 0 40 40" role="img" aria-label={org.name}>
      <g fill="currentColor">{ORG_SHAPES[shape]}</g>
      <text x="20" y="20" dy=".35em" textAnchor="middle" fontSize={fontSize}>{mark}</text>
    </svg>
  )
}
