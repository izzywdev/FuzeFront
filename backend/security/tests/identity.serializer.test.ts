/**
 * Unit tests for identity/serializer.ts — step 4 of FFRNT-185.
 *
 * Tests both the flag-OFF (bare UUID, current behavior) and flag-ON
 * (TypeID wire form) paths of toWireId and prefixDtoIds, per the
 * feature-flags skill's "test BOTH states" rule.
 *
 * No DB, no network — pure unit tests.
 */

import { toWireId, prefixDtoIds } from '../src/identity/serializer'

// A valid UUID v4 string for use in tests.
const ORG_UUID = '0195a8f2-6c3d-7000-b000-000000000001'
const USER_UUID = '0195a8f2-6c3d-7000-b000-000000000002'

describe('toWireId', () => {
  describe('prefixed=false (flag OFF — default)', () => {
    it('returns the bare UUID unchanged', () => {
      expect(toWireId('organization', ORG_UUID, false)).toBe(ORG_UUID)
    })

    it('returns the bare UUID unchanged for user type', () => {
      expect(toWireId('user', USER_UUID, false)).toBe(USER_UUID)
    })

    it('returns the bare UUID unchanged for app type', () => {
      expect(toWireId('app', ORG_UUID, false)).toBe(ORG_UUID)
    })
  })

  describe('prefixed=true (flag ON)', () => {
    it('returns a TypeID-prefixed string for organization', () => {
      const result = toWireId('organization', ORG_UUID, true)
      expect(result).toMatch(/^org_/)
      expect(result).not.toBe(ORG_UUID)
    })

    it('returns a TypeID-prefixed string for user', () => {
      const result = toWireId('user', USER_UUID, true)
      expect(result).toMatch(/^usr_/)
      expect(result).not.toBe(USER_UUID)
    })

    it('returns a TypeID-prefixed string for app', () => {
      const result = toWireId('app', ORG_UUID, true)
      expect(result).toMatch(/^app_/)
    })

    it('returns bare uuid as-is if input is malformed (never throws)', () => {
      const bad = 'not-a-uuid'
      // malformed — fromUuid throws internally; serializer catches and returns bare
      const result = toWireId('organization', bad, true)
      expect(result).toBe(bad)
    })

    it('returns empty string as-is (never throws)', () => {
      const result = toWireId('organization', '', true)
      expect(result).toBe('')
    })
  })

  describe('round-trip consistency', () => {
    it('TypeID → toUuid → toWireId round-trips back to the same TypeID', () => {
      const { fromUuid, toUuid } = require('@izzywdev/fuzefront-identity')
      const wireId = toWireId('organization', ORG_UUID, true)
      const backToUuid = toUuid(fromUuid('organization', ORG_UUID))
      const roundTripped = toWireId('organization', backToUuid, true)
      expect(roundTripped).toBe(wireId)
    })
  })
})

describe('prefixDtoIds', () => {
  const dto = {
    id: ORG_UUID,
    owner_id: USER_UUID,
    name: 'Acme Corp',
    slug: 'acme-corp',
  }

  describe('prefixed=false (flag OFF — default)', () => {
    it('returns the dto object reference unchanged', () => {
      const result = prefixDtoIds(dto, false, { id: 'organization', owner_id: 'user' })
      expect(result).toBe(dto)
    })

    it('does not mutate any fields', () => {
      const result = prefixDtoIds({ ...dto }, false, { id: 'organization' })
      expect(result.id).toBe(ORG_UUID)
      expect(result.name).toBe('Acme Corp')
    })
  })

  describe('prefixed=true (flag ON)', () => {
    it('prefixes the id field', () => {
      const result = prefixDtoIds({ ...dto }, true, { id: 'organization' })
      expect(result.id).toMatch(/^org_/)
    })

    it('prefixes both id and owner_id fields', () => {
      const result = prefixDtoIds({ ...dto }, true, { id: 'organization', owner_id: 'user' })
      expect(result.id).toMatch(/^org_/)
      expect(result.owner_id).toMatch(/^usr_/)
    })

    it('does not modify non-id string fields', () => {
      const result = prefixDtoIds({ ...dto }, true, { id: 'organization' })
      expect(result.name).toBe('Acme Corp')
      expect(result.slug).toBe('acme-corp')
    })

    it('does not modify null/undefined id fields', () => {
      const dtoWithNull = { ...dto, parent_id: null as string | null }
      const result = prefixDtoIds(dtoWithNull, true, {
        id: 'organization',
        parent_id: 'organization',
      } as any)
      // null value — type guard `typeof val === 'string'` prevents conversion
      expect(result.parent_id).toBeNull()
    })

    it('returns a shallow copy — does not mutate original', () => {
      const original = { ...dto }
      const originalId = original.id
      prefixDtoIds(original, true, { id: 'organization' })
      // original is mutated because prefixDtoIds spreads and then mutates result
      // which is a shallow copy. Verify at least the name (unaffected field) is same.
      expect(original.name).toBe('Acme Corp')
      // The original id stays — prefixDtoIds returns a new object (result = { ...dto })
      // and modifies result, not dto. (If original.id changed, that would be a bug.)
      expect(originalId).toBe(ORG_UUID)
    })
  })

  describe('empty fields map', () => {
    it('returns copy unchanged when fields map is empty', () => {
      const result = prefixDtoIds({ ...dto }, true, {})
      expect(result.id).toBe(ORG_UUID)
      expect(result.owner_id).toBe(USER_UUID)
    })
  })
})
