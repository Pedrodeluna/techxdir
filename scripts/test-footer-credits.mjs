import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

for (const path of ['web/src/pages/Landing.tsx', 'web/src/features/badge/BadgeApp.tsx']) {
  test(`${path} includes Saul alongside the existing footer credits`, () => {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    const footer = source.match(/<footer\b[\s\S]*?<\/footer>/)?.[0]
    assert.ok(footer, 'The page must retain its footer')
    for (const handle of ['pedrodelunah', 'franms_dev', 'elashera', 'Saulgmz_']) {
      const href = handle === 'Saulgmz_' ? `https://x.com/${handle}?s=20` : `https://x.com/${handle}`
      assert.ok(footer.includes(`<a href="${href}" target="_blank" rel="noopener noreferrer">@${handle}</a>`), `Missing safe credit link for @${handle}`)
    }
    assert.ok(footer.includes('<Link to="/privacidad">Privacidad</Link>'), 'Privacy navigation must remain')
  })
}
