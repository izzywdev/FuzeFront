/**
 * Every `@fuzefront/shared/<subpath>` import in this repo must name a subpath
 * the package actually declares in its `exports` map.
 *
 * A package.json with an `exports` field makes every UNDECLARED subpath
 * unreachable — Node throws ERR_PACKAGE_PATH_NOT_EXPORTED rather than falling
 * back to plain path resolution. `@fuzefront/shared` exports `.` and `./kafka`;
 * it does not export `./dist/kafka`. Requiring the latter therefore fails at
 * resolution time, which is what crash-looped applications-service in prod:
 * `src/kafka/ref-index.consumer.ts` required it at module scope, unguarded.
 *
 * Nothing caught it earlier because the two other call sites
 * (`app-registry/events.ts`) sit inside a `try/catch` that swallowed the same
 * failure, so the deep path looked like it worked while never once resolving.
 * Type-checking cannot catch this either — these are untyped `require()` calls,
 * and a wrong string is still a valid string.
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const REPO_ROOT = path.resolve(__dirname, '../../..')
const SHARED_PKG = path.join(REPO_ROOT, 'shared', 'package.json')

/**
 * billing-service still imports `@fuzefront/shared/dist/kafka`. It does not
 * crash only because its runtime image copies `shared/dist` WITHOUT
 * `shared/package.json` (see services/billing-service/Dockerfile), so there is
 * no `exports` map in the image to enforce — it works by accident, and adding
 * that one COPY line would break it exactly as applications-service broke.
 * Recorded here as a known exception rather than silently excluded; migrating
 * it needs its tsconfig `paths` and jest moduleNameMapper updated too, which
 * is deliberately not bundled into an incident fix for a different service.
 */
const KNOWN_UNMIGRATED = ['services/billing-service/']

const IMPORT_RE = /['"`]@fuzefront\/shared(\/[^'"`]+)?['"`]/g

function trackedSourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '*.ts', '*.tsx', '*.js', '*.mjs', '*.cjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return out
    .split('\0')
    .filter(Boolean)
    .filter(f => !f.includes('node_modules/'))
}

describe('@fuzefront/shared subpath imports resolve against its exports map', () => {
  const exportsMap: Record<string, unknown> = JSON.parse(fs.readFileSync(SHARED_PKG, 'utf-8')).exports
  const declared = new Set(Object.keys(exportsMap))

  it('declares the subpaths this repo relies on', () => {
    // Guards the other direction: someone narrowing `exports` would otherwise
    // break every importer with no test failing here.
    expect(declared.has('.')).toBe(true)
    expect(declared.has('./kafka')).toBe(true)
  })

  it('has no import naming an undeclared subpath', () => {
    const offenders: string[] = []

    for (const file of trackedSourceFiles()) {
      if (KNOWN_UNMIGRATED.some(prefix => file.startsWith(prefix))) continue
      const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8')
      for (const m of text.matchAll(IMPORT_RE)) {
        const subpath = m[1] ? `.${m[1]}` : '.'
        // A wildcard entry ("./dist/*") would cover a family of subpaths.
        const covered =
          declared.has(subpath) ||
          [...declared].some(d => d.includes('*') && matchesWildcard(d, subpath))
        if (!covered) offenders.push(`${file}: ${subpath}`)
      }
    }

    expect(offenders).toEqual([])
  })
})

function matchesWildcard(pattern: string, subpath: string): boolean {
  const [head, tail] = pattern.split('*')
  return subpath.startsWith(head) && subpath.endsWith(tail ?? '')
}
