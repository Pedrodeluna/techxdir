import { useRef, useState, type FormEvent } from 'react'
import type { Me } from '../../../data/sample'
import { Photo } from '../bits'
import { at, replay } from '../dom'
import { cropPhoto } from '../lib/cropPhoto'
import { joinedYear } from '../model'
import { useNotify } from '../Toast'

interface Props {
  me: Me
  /** Vista previa en vivo sobre la propia acreditación */
  onDraft: (draft: Me) => void
  onSave: (me: Me) => void
  onCancel: () => void
}

type Fields = Pick<Me, 'name' | 'handle' | 'role' | 'company' | 'bio'>

export function BioPanel({ me, onDraft, onSave, onCancel }: Props) {
  const notify = useNotify()
  const [fields, setFields] = useState<Fields>({
    name: me.name, handle: me.handle, role: me.role, company: me.company, bio: me.bio,
  })
  const [photo, setPhoto] = useState(me.photo)
  const [invalid, setInvalid] = useState<Partial<Record<'name' | 'handle', boolean>>>({})
  const previewRef = useRef<HTMLSpanElement>(null)

  const draft = (f = fields, p = photo): Me => ({
    name: f.name.trim(),
    handle: f.handle.trim(),
    role: f.role.trim(),
    company: f.company.trim(),
    bio: f.bio.trim(),
    photo: p,
    joined: joinedYear(me),
  })

  const set = (key: keyof Fields, value: string) => {
    if (key === 'handle') value = value.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '')
    const next = { ...fields, [key]: value }
    setFields(next)
    onDraft(draft(next))
  }

  const changePhoto = (next: string | null) => {
    setPhoto(next)
    onDraft(draft(fields, next))
  }

  const pick = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    if (!file) return
    try {
      changePhoto(await cropPhoto(file))
      replay(previewRef.current, 'stamp')
    } catch {
      notify('No se ha podido leer esa imagen')
    }
    input.value = ''
  }

  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    const next = draft()
    const bad = { name: !next.name, handle: !next.handle }
    setInvalid(bad)
    if (bad.name || bad.handle) return
    onSave(next)
  }

  const field = (key: keyof Fields) => ({
    name: key,
    value: fields[key],
    onChange: (ev: { target: { value: string } }) => set(key, ev.target.value),
  })

  return (
    <form className="stagger" noValidate onSubmit={submit}>
      <div className="photo-row" style={at(0)}>
        <label className="photo-pick" title="Cambiar foto">
          <input className="sr-only" type="file" accept="image/*" id="photoInput" onChange={ev => pick(ev.currentTarget)} />
          <span className="photo-preview" ref={previewRef}><Photo photo={photo} name={fields.name || '?'} /></span>
        </label>
        <div className="photo-actions">
          <label className="link" htmlFor="photoInput">Cambiar foto</label>
          <button className="link" type="button" hidden={!photo} onClick={() => changePhoto(null)}>Quitar foto</button>
          <small>Se recorta en vertical (4:5)</small>
        </div>
      </div>

      <label className={`field${invalid.name ? ' invalid' : ''}`} style={at(1)}><span>Nombre</span>
        <input {...field('name')} maxLength={40} required autoComplete="name" />
      </label>

      <label className={`field${invalid.handle ? ' invalid' : ''}`} style={at(2)}><span>Usuario de X</span>
        <span className="prefixed"><input {...field('handle')} maxLength={15} required spellCheck={false} autoComplete="off" /></span>
      </label>

      <div className="two-col" style={at(3)}>
        <label className="field"><span>Rol</span><input {...field('role')} maxLength={40} /></label>
        <label className="field"><span>Empresa</span><input {...field('company')} maxLength={30} /></label>
      </div>

      <label className="field" style={at(4)}><span>Bio <em>{fields.bio.length}/160</em></span>
        <textarea {...field('bio')} maxLength={160} rows={3} />
      </label>

      <div className="actions" style={at(5)}>
        <button className="link" type="button" onClick={onCancel}>Cancelar</button>
        <button className="primary" type="submit">Guardar</button>
      </div>
    </form>
  )
}
