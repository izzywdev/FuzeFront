import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  SEED_LIMITS,
  SEED_REQUESTED_TOPIC,
  SeedRequestValidationError,
  buildSeedRequest,
  buildSeedRequestEnvelope,
  seedRequestKafkaKey,
  type BuildSeedRequestInput,
} from '../src/index'

// Golden fixtures shared with the Zod schema tests (shared/) and the Python
// helper tests, so the three cannot drift apart without a red test.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared', 'tests', 'fixtures', 'selection-lists')
const load = (name: string): any => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

function input(): BuildSeedRequestInput {
  const raw = load('seed-request.input.json')
  delete raw.$comment
  return raw
}

function issuesOf(fn: () => unknown): string[] {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(SeedRequestValidationError)
    return (err as SeedRequestValidationError).issues.map((i) => `${i.path}: ${i.message}`)
  }
  throw new Error('expected SeedRequestValidationError')
}

describe('buildSeedRequest', () => {
  it('produces the golden payload (validated against the Zod schema in shared/)', () => {
    expect(buildSeedRequest(input())).toEqual(load('seed-request.expected.json'))
  })

  it('defaults scope to org, trigger to app-installed, sourceLocale to en', () => {
    const i = input()
    delete i.trigger
    const p = buildSeedRequest(i)
    expect(p.scope).toBe('org')
    expect(p.trigger).toBe('app-installed')
    expect(p.lists[0]!.sourceLocale).toBe('en')
    expect(p.userId).toBeUndefined()
  })

  it('does not mutate its input', () => {
    const i = input()
    const before = JSON.stringify(i)
    buildSeedRequest(i)
    expect(JSON.stringify(i)).toBe(before)
  })

  it('rejects a smuggled id on a list or item', () => {
    const i = input() as any
    i.lists[0].id = 'front_sl_01h455vb4pex5vsknk084sn02q'
    i.lists[0].items[0].id = 'front_sli_01h455vb4pex5vsknk084sn02q'
    const issues = issuesOf(() => buildSeedRequest(i))
    expect(issues).toContain('lists.0.id: ids are minted by the service; do not send one')
    expect(issues).toContain('lists.0.items.0.id: ids are minted by the service; do not send one')
  })

  it('enforces the <app>- namespace by default, and keyPrefix overrides it', () => {
    const i = input()
    i.lists[0]!.key = 'deal-stages'
    expect(issuesOf(() => buildSeedRequest(i))).toContain('lists.0.key: must start with the namespace prefix "fuzecrm-"')
    expect(() => buildSeedRequest({ ...i, keyPrefix: '' })).not.toThrow()
  })

  it('reserves the platform source', () => {
    expect(issuesOf(() => buildSeedRequest({ ...input(), app: 'platform', keyPrefix: '' }))).toContain(
      `source.app: "platform" is reserved for the service's own packs`,
    )
  })

  it('requires a bare-UUID org to be converted to an org_ TypeID', () => {
    const issues = issuesOf(() =>
      buildSeedRequest({ ...input(), organizationId: '0195a8f2-7c1e-7b3a-9f00-1a2b3c4d5e6f' }),
    )
    expect(issues.some((m) => m.startsWith('organizationId:'))).toBe(true)
  })

  it('scope user needs a usr_ userId; scope org forbids one', () => {
    expect(issuesOf(() => buildSeedRequest({ ...input(), scope: 'user' }))).toContain(
      'userId: is required when scope is "user"',
    )
    const ok = buildSeedRequest({ ...input(), scope: 'user', userId: 'usr_01h455vb4pex5vsknk084sn02q' })
    expect(ok.userId).toBe('usr_01h455vb4pex5vsknk084sn02q')
    expect(issuesOf(() => buildSeedRequest({ ...input(), userId: 'usr_01h455vb4pex5vsknk084sn02q' }))).toContain(
      'userId: must be omitted when scope is "org"',
    )
  })

  it('rejects duplicate keys/codes, source-locale and duplicate translations', () => {
    const i = input()
    i.lists[1]!.key = i.lists[0]!.key
    i.lists[0]!.items[1]!.code = 'LEAD'
    i.lists[0]!.translations = [
      { locale: 'en', name: 'x' },
      { locale: 'es', name: 'a' },
      { locale: 'es', name: 'b' },
    ]
    const issues = issuesOf(() => buildSeedRequest(i))
    expect(issues).toContain('lists.1.key: duplicate list key "fuzecrm-deal-stages"')
    expect(issues).toContain('lists.0.items.1.code: duplicate item code "LEAD" in list "fuzecrm-deal-stages"')
    expect(issues).toContain('lists.0.translations.0.locale: "en" is the source locale; put that text in name')
    expect(issues).toContain('lists.0.translations.2.locale: duplicate locale "es"')
  })

  it('reports every problem at once', () => {
    const i = input()
    i.requestId = ''
    i.packVersion = 0
    i.serviceToken = ''
    expect(issuesOf(() => buildSeedRequest(i)).length).toBeGreaterThanOrEqual(3)
  })

  it('enforces count ceilings', () => {
    const many = input()
    many.lists = Array.from({ length: SEED_LIMITS.MAX_LISTS_PER_SEED + 1 }, (_, n) => ({
      key: `fuzecrm-l${n}`,
      name: `L${n}`,
      items: [],
    }))
    expect(issuesOf(() => buildSeedRequest(many))).toContain('lists: at most 20 lists per request')

    const total = input()
    total.lists = Array.from({ length: 5 }, (_, l) => ({
      key: `fuzecrm-l${l}`,
      name: `L${l}`,
      items: Array.from({ length: 401 }, (_, n) => ({ code: `C${n}`, label: `C${n}` })),
    }))
    expect(issuesOf(() => buildSeedRequest(total)).some((m) => m.includes('items in total'))).toBe(true)
  })

  it('rejects an oversized serialized request', () => {
    const big = input()
    big.lists = Array.from({ length: 4 }, (_, l) => ({
      key: `fuzecrm-l${l}`,
      name: `L${l}`,
      items: Array.from({ length: 500 }, (_, n) => ({ code: `C${n}`, label: 'x'.repeat(200), description: 'y'.repeat(300) })),
    }))
    expect(issuesOf(() => buildSeedRequest(big)).some((m) => m.includes('bytes'))).toBe(true)
  })
})

describe('envelope + key', () => {
  it('wraps the payload in the family envelope and keys by org', () => {
    const p = buildSeedRequest(input())
    const env = buildSeedRequestEnvelope(p, { correlationId: 'c-1', occurredAt: '2026-10-04T12:00:00.000Z' })
    expect(env).toEqual({
      version: '1.0',
      topic: SEED_REQUESTED_TOPIC,
      correlationId: 'c-1',
      occurredAt: '2026-10-04T12:00:00.000Z',
      payload: p,
    })
    expect(seedRequestKafkaKey(p)).toBe('org_01h455vb4pex5vsknk084sn02q')
  })
})
