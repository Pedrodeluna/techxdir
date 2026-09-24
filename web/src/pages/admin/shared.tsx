import { useState, type FormEvent, type ReactNode } from 'react'
import { useAdmin, type Org } from './context'

export function SectionHead({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <header className="adm-head">
      <h1>{title}{count !== undefined && <span className="adm-head-count">{count}</span>}</h1>
      {action}
    </header>
  )
}

export function OrgMark({ org, size = 'md' }: { org: Pick<Org, 'name' | 'logo'>; size?: 'sm' | 'md' }) {
  const logo = org.logo
  if (typeof logo === 'string' && logo) return <span className={`adm-mark adm-mark-${size}`}><img src={logo} alt="" /></span>
  const mark = typeof logo === 'object' && logo?.mark ? logo.mark : org.name.slice(0, 2).toUpperCase()
  const shape = typeof logo === 'object' && logo?.shape ? logo.shape : 'circle'
  return <span className={`adm-mark adm-mark-${size} shape-${shape}`} aria-hidden="true">{mark}</span>
}

/** Destructive action with an inline confirmation: type the identifier, then confirm. */
export function DangerZone({ id, label, consequence, onConfirm }: {
  id: string; label: string; consequence: string; onConfirm: () => void
}) {
  const { busy } = useAdmin()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (typed === id) onConfirm()
  }
  if (!open) return <button type="button" className="adm-link adm-danger-link" onClick={() => setOpen(true)}>{label}</button>
  return (
    <form className="adm-danger" onSubmit={submit}>
      <p>{consequence}</p>
      <label className="adm-field">
        <span>Escribe <code>{id}</code> para confirmar</span>
        <input autoFocus autoComplete="off" spellCheck={false} value={typed} onChange={event => setTyped(event.target.value)} />
      </label>
      <div className="adm-actions">
        <button className="adm-pill adm-pill-danger" disabled={busy || typed !== id}>{label}</button>
        <button type="button" className="adm-link" onClick={() => { setOpen(false); setTyped('') }}>Cancelar</button>
      </div>
    </form>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="adm-empty">{children}</p>
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="adm-ledger" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => <li key={i} className="adm-skeleton"><span /><span /></li>)}
    </ul>
  )
}
