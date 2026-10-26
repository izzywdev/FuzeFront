/**
 * Unit tests for identity/serializer.ts — FFRNT-185.
 *
 * The TypeID wire form is unconditional (the `prefixed-ids` release flag was
 * retired at 100 %), so there is no bare-UUID response path to test: every id
 * field handed to toWireId / prefixDtoIds comes back in TypeID form.
 *
 * No DB, no network — pure unit tests.
 */

import { toWireId, prefixDtoIds } from '../src/identity/serializer'

// A valid UUID v4 string for use in tests.
const ORG_UUID = '0195a8f2-6c3d-7000-b000-000000000001'
const USER_UUID = '0195a8f2-6c3d-7000-b000-000000000002'

describe('toWireId', () => {
  it('returns a TypeID-prefixed string for organization', () => {
    const result = toWireId('organization', ORG_UUID)
    expect(result).toMatch(/^org_/)
    expect(result).not.toBe(ORG_UUID)
  })

  it('returns a TypeID-prefixed string for user', () => {
    const result = toWireId('user', USER_UUID)
    expect(result).toMatch(/^usr_/)
    expect(result).not.toBe(USER_UUID)
  })

  it('returns a TypeID-prefixed string for app', () => {
    expect(toWireId('app', ORG_UUID)).toMatch(/^app_/)
  })

  it('returns the input as-is if it is malformed (never throws)', () => {
    const bad = 'not-a-uuid'
    // malformed — fromUuid throws internally; serializer catches and returns it unchanged
    expect(toWireId('organization', bad)).toBe(bad)
  })

  it('returns empty string as-is (never throws)', () => {
    expect(toWireId('organization', '')).toBe('')
  })

  it('TypeID → toUuid → toWireId round-trips back to the same TypeID', () => {
    const { fromUuid, toUuid } = require('@izzywdev/fuzefront-identity')
    const wireId = toWireId('organization', ORG_UUID)
    const backToUuid = toUuid(fromUuid('organization', ORG_UUID))
    expect(toWireId('organization', backToUuid)).toBe(wireId)
  })
})

describe('prefixDtoIds', () => {
  const dto = {
    id: ORG_UUID,
    owner_id: USER_UUID,
    name: 'Acme Corp',
    slug: 'acme-corp',
  }

  it('prefixes the id field', () => {
    const result = prefixDtoIds({ ...dto }, { id: 'organization' })
    expect(result.id).toMatch(/^org_/)
  })

  it('prefixes both id and owner_id fields', () => {
    const result = prefixDtoIds({ ...dto }, { id: 'organization', owner_id: 'user' })
    expect(result.id).toMatch(/^org_/)
    expect(result.owner_id).toMatch(/^usr_/)
  })

  it('does not modify non-id string fields', () => {
    const result = prefixDtoIds({ ...dto }, { id: 'organization' })
    expect(result.name).toBe('Acme Corp')
    expect(result.slug).toBe('acme-corp')
  })

  it('does not modify null/undefined/empty id fields', () => {
    const dtoWithNull = { ...dto, parent_id: null as string | null, other_id: '' }
    const result = prefixDtoIds(dtoWithNull, {
      id: 'organization',
      parent_id: 'organization',
      other_id: 'organization',
    } as any)
    // type guard `typeof val === 'string' && val.length > 0` prevents conversion
    expect(result.parent_id).toBeNull()
    expect(result.other_id).toBe('')
  })

  it('returns a shallow copy — does not mutate the original', () => {
    const original = { ...dto }
    const result = prefixDtoIds(original, { id: 'organization' })
    expect(result).not.toBe(original)
    expect(original.id).toBe(ORG_UUID)
  })

  it('returns an unchanged copy when the fields map is empty', () => {
    const result = prefixDtoIds({ ...dto }, {})
    expect(result.id).toBe(ORG_UUID)
    expect(result.owner_id).toBe(USER_UUID)
  })
})
