import { assertEquals } from 'jsr:@std/assert@1'
import { validate } from './validate.ts'

Deno.test('accepts a partial patch and trims values', () => {
  assertEquals(validate({ name: '  Ada ', handle: '@ada_l' }), { patch: { name: 'Ada', handle: 'ada_l' } })
})

Deno.test('rejects an invalid handle', () => {
  assertEquals(validate({ handle: 'no spaces' }), { error: 'handle must be 1-15 letters, digits or underscores' })
})

Deno.test('rejects a bio over 160 characters', () => {
  assertEquals(validate({ bio: 'x'.repeat(161) }), { error: 'bio is longer than 160 characters' })
})

Deno.test('rejects an empty body', () => {
  assertEquals(validate({}), { error: 'Nothing to update' })
})

Deno.test('rejects a non-https photo', () => {
  assertEquals(validate({ photo_url: 'http://x.test/a.png' }), { error: 'photo_url must be an https URL or null' })
})
