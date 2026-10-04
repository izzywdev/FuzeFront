import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  DELETED_USER_SENTINEL,
  SYSTEM_PRINCIPAL_PREFIX,
  USER_ID_PREFIX,
  authorPrincipalKind,
  isUserAuthor,
  type AuthorPrincipal,
  type SeedProvenance,
  type SelectionList,
  type SelectionListAccessGrant,
  type SelectionListItem,
} from '../src/index'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SPEC = readFileSync(join(ROOT, 'services', 'selection-list-service', 'openapi.yaml'), 'utf8')

/** The YAML block of one `components.schemas` entry (4-space indented name). */
function schemaBlock(name: string): string {
  const start = SPEC.indexOf(`\n    ${name}:\n`)
  expect(start, `schema ${name} in openapi.yaml`).toBeGreaterThan(-1)
  const rest = SPEC.slice(start + 1)
  const next = rest.slice(1).search(/\n {4}[A-Za-z]/)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

describe('AuthorPrincipal (contract 4.0.0)', () => {
  it('classifies the three disjoint forms from the string alone', () => {
    expect(authorPrincipalKind('usr_01h455vb4pex5vsknk084sn02q')).toBe('user')
    expect(authorPrincipalKind('system:selection-list-service')).toBe('system')
    expect(authorPrincipalKind('[deleted-user]')).toBe('deleted-user')
    expect(authorPrincipalKind('org_01h455vb4pex5vsknk084sn02q')).toBe('unknown')
    expect(authorPrincipalKind('')).toBe('unknown')
  })

  it('isUserAuthor is true only for a usr_ id', () => {
    expect(isUserAuthor('usr_01h455vb4pex5vsknk084sn02q')).toBe(true)
    expect(isUserAuthor('system:selection-list-service')).toBe(false)
    expect(isUserAuthor(DELETED_USER_SENTINEL)).toBe(false)
  })

  it('the sentinel matches the spec const and what the service handler writes', () => {
    expect(schemaBlock('DeletedUserSentinel')).toContain(`const: '${DELETED_USER_SENTINEL}'`)
    const handler = readFileSync(
      join(ROOT, 'services', 'selection-list-service', 'src', 'events', 'user-deleted.handler.ts'),
      'utf8',
    )
    expect(handler).toContain(`const sentinel = '${DELETED_USER_SENTINEL}'`)
  })

  it('the prefixes match the spec patterns', () => {
    expect(schemaBlock('SystemPrincipal')).toContain(`pattern: '^${SYSTEM_PRINCIPAL_PREFIX}[a-z0-9-]+$'`)
    expect(schemaBlock('UserId')).toContain(`pattern: '^${USER_ID_PREFIX}[0-9a-z]+$'`)
    const author = schemaBlock('AuthorPrincipal')
    for (const ref of ['UserId', 'SystemPrincipal', 'DeletedUserSentinel']) {
      expect(author).toContain(`$ref: '#/components/schemas/${ref}'`)
    }
  })

  it('created_by / granted_by are AuthorPrincipal and still read as string', () => {
    expectTypeOf<SelectionList['created_by']>().toEqualTypeOf<AuthorPrincipal>()
    expectTypeOf<SelectionListItem['created_by']>().toEqualTypeOf<AuthorPrincipal>()
    expectTypeOf<SelectionListAccessGrant['granted_by']>().toEqualTypeOf<AuthorPrincipal>()
    expectTypeOf<AuthorPrincipal>().toMatchTypeOf<string>()
  })
})

describe('seed provenance (contract 4.0.0)', () => {
  it('is a required, nullable property on lists and items', () => {
    expectTypeOf<SelectionList['seed']>().toEqualTypeOf<SeedProvenance | null>()
    expectTypeOf<SelectionListItem['seed']>().toEqualTypeOf<SeedProvenance | null>()
    for (const name of ['SelectionList', 'SelectionListItem']) {
      const block = schemaBlock(name)
      expect(block, `${name} requires seed`).toMatch(/\n {8}- seed\n/)
      expect(block).toContain("$ref: '#/components/schemas/SeedProvenance'")
      expect(block).toContain("- type: 'null'")
    }
  })

  it('SeedProvenance carries exactly the four contract fields', () => {
    const block = schemaBlock('SeedProvenance')
    expect(block).toContain('required: [source, pack_key, pack_version, user_modified]')
    expect(block).toContain('additionalProperties: false')
    const sample: SeedProvenance = { source: 'platform', pack_key: 'platform-defaults', pack_version: 1, user_modified: false }
    expect(Object.keys(sample).sort()).toEqual(['pack_key', 'pack_version', 'source', 'user_modified'])
  })
})
