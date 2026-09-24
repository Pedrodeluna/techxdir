/* Spanish text for the Postgres and PostgREST errors the organization and admin pages can get. */
export function errorText(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : ''
  if (message.includes('manager handle not found') || message.includes('handle not found')) return 'No existe una persona con ese usuario.'
  if (message.includes('at least one admin')) return 'Debe quedar al menos un administrador.'
  if (message.includes('admins cannot ban themselves')) return 'No puedes bloquearte a ti.'
  if (message.includes('admins cannot be banned')) return 'Quita el rol de administrador antes de bloquear a esta persona.'
  if (message.includes('banned people cannot be admins')) return 'Esa persona está bloqueada. Desbloquéala antes.'
  if (code === '23505') return 'Ese identificador o esa persona ya existe.'
  if (code === '23514') return message.includes('manager') ? 'La organización debe conservar al menos un gestor.' : 'Algún valor no cumple las reglas. Revisa el formulario.'
  if (code === '23503') return 'La organización elegida no existe.'
  if (code === '42501') return 'No tienes permisos para hacer ese cambio.'
  return message || 'No se pudo guardar el cambio.'
}
