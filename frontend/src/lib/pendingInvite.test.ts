import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingInvite,
  invitePath,
  isSafeInviteToken,
  readPendingInvite,
  savePendingInvite,
} from './pendingInvite'

afterEach(() => {
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('pendingInvite', () => {
  it('round-trips the opaque token and clears it', () => {
    savePendingInvite('tok_AbC-123')
    expect(readPendingInvite()).toBe('tok_AbC-123')
    clearPendingInvite()
    expect(readPendingInvite()).toBeNull()
  })

  it('refuses anything that is not a bounded, path-safe opaque token (no open redirect)', () => {
    for (const bad of ['', 'a/b', '../x', 'https://evil.test', 'has space', 'x'.repeat(513), 'javascript:alert(1)']) {
      expect(isSafeInviteToken(bad)).toBe(false)
      savePendingInvite(bad)
      expect(readPendingInvite()).toBeNull()
    }
  })

  it('ignores a tampered stored value', () => {
    window.sessionStorage.setItem('fuzefront:invite:pending', 'https://evil.test/x')
    expect(readPendingInvite()).toBeNull()
  })

  it('builds an in-app path only', () => {
    expect(invitePath('tok_1')).toBe('/invitations/tok_1')
  })

  it('degrades to no-carry when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => savePendingInvite('tok_1')).not.toThrow()
    expect(readPendingInvite()).toBeNull()
  })
})
