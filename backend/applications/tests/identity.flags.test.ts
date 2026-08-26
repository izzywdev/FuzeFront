/**
 * Unit tests for applications/src/identity/flags.ts — step 4 of FFRNT-185.
 *
 * Tests both the flag-OFF (default, release flag) and flag-ON paths of
 * isPrefixedIdsEnabled for the applications-service slice, per the
 * feature-flags skill's "test BOTH states" rule.
 *
 * No DB, no network — pure unit tests.
 */

import {
  isPrefixedIdsEnabled,
  setIdentityFlagClient,
  IDENTITY_FLAGS,
  FlagClientLike,
} from '../src/identity/flags'

function makeClient(value: boolean): FlagClientLike {
  return {
    async getBooleanValue(): Promise<boolean> {
      return value
    },
  }
}

function makeThrowingClient(): FlagClientLike {
  return {
    async getBooleanValue(): Promise<boolean> {
      throw new Error('flag client error')
    },
  }
}

afterEach(() => {
  setIdentityFlagClient(null)
})

describe('IDENTITY_FLAGS constants', () => {
  it('exposes the correct flag name', () => {
    expect(IDENTITY_FLAGS.PREFIXED_IDS).toBe('fuzefront.identity.prefixed-ids')
  })
})

describe('isPrefixedIdsEnabled — applications-service', () => {
  describe('flag OFF (release default)', () => {
    it('returns false when no client is available (fail-safe)', async () => {
      setIdentityFlagClient(null)
      expect(await isPrefixedIdsEnabled()).toBe(false)
    })

    it('returns false when client returns false', async () => {
      setIdentityFlagClient(makeClient(false))
      expect(await isPrefixedIdsEnabled()).toBe(false)
    })

    it('returns false when client throws (fail-safe)', async () => {
      setIdentityFlagClient(makeThrowingClient())
      expect(await isPrefixedIdsEnabled()).toBe(false)
    })
  })

  describe('flag ON', () => {
    it('returns true when client returns true', async () => {
      setIdentityFlagClient(makeClient(true))
      expect(await isPrefixedIdsEnabled()).toBe(true)
    })

    it('returns true with context when client returns true', async () => {
      setIdentityFlagClient(makeClient(true))
      expect(await isPrefixedIdsEnabled({ orgId: 'org_01h', userId: 'usr_01h' })).toBe(true)
    })
  })

  describe('DI seam', () => {
    it('records the correct flag key in the client call', async () => {
      const calls: string[] = []
      setIdentityFlagClient({
        async getBooleanValue(key) {
          calls.push(key)
          return false
        },
      })
      await isPrefixedIdsEnabled()
      expect(calls).toContain(IDENTITY_FLAGS.PREFIXED_IDS)
    })
  })
})
