/**
 * Unit tests for identity/flags.ts — step 4 of FFRNT-185.
 *
 * Tests both the flag-OFF (default, release flag) and flag-ON paths of
 * isPrefixedIdsEnabled, plus the DI seam (setIdentityFlagClient), per the
 * feature-flags skill's "test BOTH states" rule.
 *
 * No DB, no network — pure unit tests.
 */

import {
  isPrefixedIdsEnabled,
  setIdentityFlagClient,
  FLAGS,
  FlagClientLike,
} from '../src/identity/flags'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeClient(value: boolean): FlagClientLike {
  return {
    async getBooleanValue(_key: string, defaultValue: boolean): Promise<boolean> {
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

// Clean up injected client after each test.
afterEach(() => {
  setIdentityFlagClient(null)
})

// ── constants ─────────────────────────────────────────────────────────────────

describe('FLAGS constants', () => {
  it('exposes the correct flag name', () => {
    expect(FLAGS.PREFIXED_IDS).toBe('fuzefront.identity.prefixed-ids')
  })
})

// ── isPrefixedIdsEnabled ──────────────────────────────────────────────────────

describe('isPrefixedIdsEnabled', () => {
  describe('flag OFF path (release default)', () => {
    it('returns false when no client is available (fail-safe)', async () => {
      // No injected client; lazy require will fail in test env (no real Unleash).
      // The function must return false rather than throw.
      setIdentityFlagClient(null)
      const result = await isPrefixedIdsEnabled()
      expect(result).toBe(false)
    })

    it('returns false when the injected client returns false', async () => {
      setIdentityFlagClient(makeClient(false))
      const result = await isPrefixedIdsEnabled()
      expect(result).toBe(false)
    })

    it('returns false when the injected client throws (fail-safe)', async () => {
      setIdentityFlagClient(makeThrowingClient())
      const result = await isPrefixedIdsEnabled()
      expect(result).toBe(false)
    })

    it('returns false when called with context and client returns false', async () => {
      setIdentityFlagClient(makeClient(false))
      const result = await isPrefixedIdsEnabled({ orgId: 'org_01h', userId: 'usr_01h' })
      expect(result).toBe(false)
    })
  })

  describe('flag ON path', () => {
    it('returns true when the injected client returns true', async () => {
      setIdentityFlagClient(makeClient(true))
      const result = await isPrefixedIdsEnabled()
      expect(result).toBe(true)
    })

    it('returns true when called with context and client returns true', async () => {
      setIdentityFlagClient(makeClient(true))
      const result = await isPrefixedIdsEnabled({
        orgId: 'org_01h',
        userId: 'usr_01h',
        environment: 'prod',
      })
      expect(result).toBe(true)
    })
  })

  describe('DI seam (setIdentityFlagClient)', () => {
    it('uses the injected client instead of the lazy require', async () => {
      const calls: string[] = []
      const trackingClient: FlagClientLike = {
        async getBooleanValue(key) {
          calls.push(key)
          return true
        },
      }
      setIdentityFlagClient(trackingClient)
      await isPrefixedIdsEnabled()
      expect(calls).toContain(FLAGS.PREFIXED_IDS)
    })

    it('can be reset to null (falls back to fail-safe false)', async () => {
      setIdentityFlagClient(makeClient(true))
      expect(await isPrefixedIdsEnabled()).toBe(true)

      setIdentityFlagClient(null)
      // Without a real Unleash in test env, null client → false
      expect(await isPrefixedIdsEnabled()).toBe(false)
    })
  })
})
