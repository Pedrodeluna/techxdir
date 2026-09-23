import assert from 'node:assert/strict'
import test from 'node:test'
import { xProfilePhoto } from '../src/features/badge/lib/xProfilePhoto.ts'

test('uses the full-size X avatar while preserving its query string', () => {
  assert.equal(
    xProfilePhoto('https://pbs.twimg.com/profile_images/123456/avatar_normal.jpg?foo=bar'),
    'https://pbs.twimg.com/profile_images/123456/avatar.jpg?foo=bar',
  )
})

test('leaves uploaded images and unrelated URLs untouched', () => {
  for (const url of [
    'data:image/jpeg;base64,abc',
    'https://images.example.com/profile_images/123/avatar_normal.jpg',
    'https://pbs.twimg.com/profile_images/123/avatar_400x400.jpg',
    'https://pbs.twimg.com/media/photo_normal.jpg',
    'https://pbs.twimg.com/profile_images/123/avatar_normal.jpg/other',
  ]) assert.equal(xProfilePhoto(url), url)
})
