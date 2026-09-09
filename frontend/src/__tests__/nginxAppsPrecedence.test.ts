import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Guards the ONE nginx directive that decides whether any Module-Federation
 * remote can load at all.
 *
 * frontend/nginx.conf proxies `/apps/<slug>/*` to the backend's same-origin
 * federated asset proxy. That block is declared AFTER
 * `location ~* \.(js|css|png|...)$`, and nginx does not resolve locations by
 * "longest prefix wins". Its real order is:
 *
 *   1. `=` exact
 *   2. `^~` prefix (longest) — if this matches, the regex stage is SKIPPED
 *   3. regex `~` / `~*`, in file order — first match wins, and it BEATS any
 *      plain prefix
 *   4. otherwise, the longest plain prefix
 *
 * So with a PLAIN `location /apps/`, the static-asset regex matches
 * `remoteEntry.js` first and answers `try_files $uri =404` against the SPA
 * docroot — where no remote's assets live. Every `/apps/<slug>/*.js` 404s while
 * `/apps/<slug>/` (no extension, no regex match) still proxies, which is why the
 * block looked wired up and was dead for exactly the files that matter.
 *
 * Verified against a real nginx 1.24 before this test was written: with
 * `location /apps/`, `/apps/fuzesocial/remoteEntry.js` -> 404 and
 * `/apps/fuzesocial/` -> 200; with `location ^~ /apps/`, both -> 200 and the
 * host's own `/assets/app.js` still resolves through the regex block.
 */

// Resolved from cwd, not import.meta.url: these tests run under the jsdom
// environment, where import.meta.url is an http:// URL and fileURLToPath throws
// ERR_INVALID_URL_SCHEME. vitest's cwd is frontend/ (its config lives there),
// but tolerate being invoked from the repo root too.
const CONF_PATH = ['nginx.conf', 'frontend/nginx.conf']
  .map((p) => resolve(process.cwd(), p))
  .find((p) => existsSync(p))

if (!CONF_PATH) {
  // A missing conf must FAIL loudly, never silently skip — a skipped guard on
  // the directive that decides whether any remote loads is worse than no guard.
  throw new Error('frontend/nginx.conf not found from cwd ' + process.cwd())
}

const CONF = readFileSync(CONF_PATH, 'utf8')

/** `location [modifier] <pattern> {` — modifier optional. */
const LOCATION_RE = /location\s+(?:(=|\^~|~\*|~)\s*)?(\S+)\s*\{/g

interface Loc {
  modifier: string
  pattern: string
  index: number
}

function parseLocations(conf: string): Loc[] {
  const out: Loc[] = []
  for (const m of conf.matchAll(LOCATION_RE)) {
    out.push({ modifier: m[1] ?? '', pattern: m[2], index: m.index ?? 0 })
  }
  return out
}

/** A path the federation runtime really requests for each remote. */
const FEDERATED_ASSETS = [
  '/apps/fuzesocial/remoteEntry.js',
  '/apps/fuzeagent/remoteEntry.js',
  '/apps/clock/remoteEntry.js',
  '/apps/fuzesocial/style.css',
]

describe('frontend/nginx.conf — /apps/ federated-remote proxy precedence', () => {
  const locations = parseLocations(CONF)
  const appsMount = locations.filter((l) => l.pattern === '/apps/')

  it('declares exactly one /apps/ mount block', () => {
    expect(appsMount).toHaveLength(1)
  })

  it('uses the ^~ modifier so the regex stage is skipped', () => {
    // Without ^~ the block is unreachable for every *.js / *.css a remote loads.
    expect(appsMount[0].modifier).toBe('^~')
  })

  it('is not shadowed by any earlier regex location for real remote assets', () => {
    const mount = appsMount[0]
    if (mount.modifier === '^~') return // ^~ short-circuits the regex stage

    const shadowing: string[] = []
    for (const loc of locations) {
      if (loc.modifier !== '~' && loc.modifier !== '~*') continue
      const re = new RegExp(loc.pattern, loc.modifier === '~*' ? 'i' : '')
      for (const asset of FEDERATED_ASSETS) {
        if (re.test(asset)) shadowing.push(`${loc.modifier} ${loc.pattern} -> ${asset}`)
      }
    }
    expect(shadowing).toEqual([])
  })

  it('still proxies the mount to the backend rather than serving from disk', () => {
    const start = appsMount[0].index
    const body = CONF.slice(start, start + 900)
    expect(body).toMatch(/proxy_pass\s+http:\/\/fuzefront-backend:\d+/)
  })
})
