import { describe, it, expect } from 'vitest'
import type { EffectiveConfigEntry, KeyDefinition, Scope } from '@fuzefront/config-client'
import { deriveProvenance, formatScope } from './provenance'

function def(overrides: Partial<KeyDefinition> = {}): KeyDefinition {
  return {
    id: 'ckd_x',
    key: 'notifications.digest.frequency',
    displayName: 'Digest frequency',
    valueType: 'enum',
    defaultValue: 'daily',
    allowedScopes: ['platform', 'portal', 'org', 'user'],
    isSystem: false,
    isHidden: false,
    isSecret: false,
    isReadonly: false,
    precedence: 'most-specific-wins',
    requiresRestart: false,
    ...overrides,
  }
}

function entry(overrides: Partial<EffectiveConfigEntry> = {}): EffectiveConfigEntry {
  return {
    key: 'notifications.digest.frequency',
    value: 'daily',
    source: { scopeType: 'org', scopeId: 'org_1' },
    locked: false,
    editable: true,
    definition: def(),
    ...overrides,
  }
}

const org: Scope = { scopeType: 'org', scopeId: 'org_1' }
const portal: Scope = { scopeType: 'portal', scopeId: 'portal_1' }
const platform: Scope = { scopeType: 'platform' }

describe('deriveProvenance', () => {
  it('renders "set" when source is the scope being edited', () => {
    expect(deriveProvenance(entry({ source: org }), org)).toBe('set')
  })

  it('renders "inherited" when source is a different, non-platform scope', () => {
    expect(deriveProvenance(entry({ source: portal }), org)).toBe('inherited')
  })

  it('renders "locked" whenever entry.locked is true, regardless of source', () => {
    expect(deriveProvenance(entry({ source: portal, locked: true }), org)).toBe('locked')
    expect(deriveProvenance(entry({ source: org, locked: true }), org)).toBe('locked')
  })

  it('renders "default" when the source is platform with no scopeId (the definition default, never overridden)', () => {
    expect(deriveProvenance(entry({ source: platform }), org)).toBe('default')
  })

  it('renders "stale" whenever entry.warning is present, even if locked/set would otherwise apply', () => {
    expect(deriveProvenance(entry({ source: org, warning: 'no longer valid' }), org)).toBe('stale')
    expect(deriveProvenance(entry({ source: org, locked: true, warning: 'no longer valid' }), org)).toBe('stale')
  })

  it('never collapses locked and set into the same state — they must diverge', () => {
    const lockedAtEditingScope = deriveProvenance(entry({ source: org, locked: true }), org)
    const setAtEditingScope = deriveProvenance(entry({ source: org, locked: false }), org)
    expect(lockedAtEditingScope).not.toBe(setAtEditingScope)
  })
})

describe('formatScope', () => {
  it('renders "<scopeType> <name>"', () => {
    expect(formatScope(org, () => 'Acme Corp')).toBe('org Acme Corp')
  })
})
