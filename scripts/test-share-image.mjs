import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const sample = moduleUrl(await read('../web/src/data/sample.ts'))
const model = moduleUrl((await read('../web/src/features/badge/model.ts')).replace("'../../data/sample'", JSON.stringify(sample)))
const photo = moduleUrl(await read('../web/src/features/badge/lib/xProfilePhoto.ts'))
const source = (await read('../web/src/features/badge/lib/shareImage.ts')).replace("'../model'", JSON.stringify(model)).replace("'./xProfilePhoto'", JSON.stringify(photo))
const { renderCardImage, renderShareImages } = await import(moduleUrl(source))

const canvases = []
const requests = []
let broken = false
let stalled = false
class FakeImage {
  naturalWidth = 120
  naturalHeight = 60
  set src(value) {
    this.url = value
    if (!value) return
    requests.push({ url: value, cors: this.crossOrigin })
    if (stalled) return
    queueMicrotask(() => broken ? this.onerror?.(new Error('CORS/network failure')) : this.onload?.())
  }
}
globalThis.Image = FakeImage
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' })
globalThis.document = {
  fonts: { ready: Promise.resolve() }, documentElement: {},
  createElement: tag => {
    assert.equal(tag, 'canvas')
    const calls = []
    const g = new Proxy({ measureText: text => ({ width: text.length * 10 }) }, {
      get: (object, key) => key in object ? object[key] : (...args) => calls.push([key, ...args]),
    })
    const canvas = { calls, width: 0, height: 0, getContext: () => g, toBlob: cb => cb(new Blob(['png'], { type: 'image/png' })) }
    canvases.push(canvas)
    return canvas
  },
}
const event = { id: 'event', org: 'org', name: 'Event', date: '2020-01-01', end: null }
const person = (id, name, avatar) => ({ id, name, avatar, events: ['event'], handle: id })
const state = {
  live: true, me: { name: 'Owner', handle: 'owner', photo: null }, myEvents: ['event'],
  catalog: { events: [event], orgs: [] },
  people: [person('1', 'Alice One', 'https://images.example/alice.png'), person('2', 'Bob Two', 'https://images.example/bob.png'), person('3', 'Carol Three', null), person('4', 'Dan Four', null), person('5', 'Eve Five', 'https://images.example/hidden.png')],
}
const photoDraws = canvas => canvas.calls.filter(([op, image]) => op === 'drawImage' && image instanceof FakeImage)
const texts = canvas => canvas.calls.filter(([op]) => op === 'fillText').map(([, value]) => value)

const download = await renderCardImage(state)
assert.equal(download.type, 'image/png')
assert.equal(photoDraws(canvases[0]).length, 2, 'Download draws both visible contact photos')
assert.ok(requests.every(r => r.cors === 'anonymous'), 'Images must remain canvas-export safe')
assert.ok(!requests.some(r => r.url.includes('hidden')), 'Do not load contacts beyond the visible stack')
assert.ok(!texts(canvases[0]).includes('AO'))
assert.ok(texts(canvases[0]).includes('CT'))
assert.ok(texts(canvases[0]).includes('+1'))
for (const [, , , , width, height] of photoDraws(canvases[0])) assert.equal(width / height, 2, 'Cover crop preserves aspect ratio')

canvases.length = 0
requests.length = 0
const shared = await renderShareImages(state)
assert.equal(shared.card.type, 'image/png')
assert.equal(shared.link.type, 'image/png')
assert.equal(photoDraws(canvases[0]).length, 2, 'Shared card includes contact photos')
assert.ok(canvases[1].calls.some(([op, image]) => op === 'drawImage' && image === canvases[0]), 'Link preview uses the same completed card')
assert.deepEqual(canvases.map(c => [c.width, c.height]), [[1080, 1350], [1200, 630]])

broken = true
canvases.length = 0
await renderCardImage(state)
assert.equal(photoDraws(canvases[0]).length, 0)
assert.ok(texts(canvases[0]).includes('AO'), 'Failed photos retain initials')
assert.ok(texts(canvases[0]).includes('BT'))
broken = false
stalled = true
const originalTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms) => originalTimeout(fn, Math.min(ms, 5))
try {
  canvases.length = 0
  await renderCardImage(state)
  assert.ok(texts(canvases[0]).includes('AO'), 'Stalled images resolve to initials')
} finally { globalThis.setTimeout = originalTimeout }
console.log('Share image checks passed: download, shared card/link, CORS fallback, timeout, crop, initials and overflow.')
