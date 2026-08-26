/**
 * Unit tests for the resolution engine (FF-EPIC-17-S4). Pure, DB-free —
 * every test builds its own definitions/values fixtures, no Postgres.
 *
 * Coverage required by the task and by EPIC-17 S4's Acceptance Criteria:
 *   - the default -> platform -> portal -> org -> user chain
 *   - BOTH precedence directions (most-specific-wins, least-specific-wins)
 *   - the lock short-circuit at the OUTERMOST locking scope, separate from precedence
 *   - provenance (source/locked/lockedBy/editable) on every entry
 *   - isHidden keys omitted entirely
 *   - isSecret keys never return their value, only isSet
 *   - a stale stored value (fails its definition's current schema) falls back
 *     to the default with a warning, rather than failing the whole resolution
 */

import { resolveEffectiveConfig } from '../../src/resolver/resolve';
import { ConfigValue, KeyDefinition, Scope } from '../../src/types';

const PLATFORM: Scope = { scopeType: 'platform', scopeId: null };
const PORTAL: Scope = { scopeType: 'portal', scopeId: 'prt_1' };
const ORG: Scope = { scopeType: 'org', scopeId: 'org_1' };
const USER: Scope = { scopeType: 'user', scopeId: 'usr_1' };
const FULL_CHAIN: Scope[] = [PLATFORM, PORTAL, ORG, USER];

function makeDefinition(overrides: Partial<KeyDefinition> = {}): KeyDefinition {
  return {
    id: 'ckd_01h455vb4pex5vsknk084sn02q' as KeyDefinition['id'],
    namespaceId: 'cns_01h455vb4pex5vsknk084sn02q' as KeyDefinition['namespaceId'],
    key: 'ui.theme.density',
    displayName: 'Density',
    description: null,
    helpUrl: null,
    category: null,
    sortOrder: 0,
    tags: [],
    valueType: 'string',
    schema: null,
    enumValues: null,
    defaultValue: 'default-value',
    allowedScopes: ['platform', 'portal', 'org', 'user'],
    isSystem: false,
    isHidden: false,
    isSecret: false,
    isReadonly: false,
    precedence: 'most-specific-wins',
    requiresRestart: false,
    deprecatedAt: null,
    replacedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

let valueSeq = 0;
function makeValue(scope: Scope, value: unknown, overrides: Partial<ConfigValue> = {}): ConfigValue {
  valueSeq += 1;
  return {
    id: `value-${valueSeq}`,
    definitionId: 'ckd_01h455vb4pex5vsknk084sn02q' as ConfigValue['definitionId'],
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    value,
    isLocked: false,
    lockReason: null,
    setByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveEffectiveConfig — the default -> platform -> portal -> org -> user chain', () => {
  it('falls back to the definition default when nothing is set anywhere', () => {
    const definition = makeDefinition();
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values: [] });

    expect(entry.value).toBe('default-value');
    expect(entry.locked).toBe(false);
    expect(entry.lockedBy).toBeNull();
    // No override anywhere in the chain: falls back to the least-specific
    // (platform) link, since default is conceptually "beneath" platform but
    // the wire ScopeType enum has no `default` member.
    expect(entry.source).toEqual(PLATFORM);
  });

  it('S4 AC1 — an org override beats the platform default; source is org; editable true', () => {
    const definition = makeDefinition();
    const platformRow = makeValue(PLATFORM, 'platform-value');
    const orgRow = makeValue(ORG, 'org-value');
    const [entry] = resolveEffectiveConfig({
      chain: FULL_CHAIN,
      definitions: [definition],
      values: [platformRow, orgRow],
    });

    expect(entry.value).toBe('org-value');
    expect(entry.source).toEqual(ORG);
    expect(entry.locked).toBe(false);
    expect(entry.editable).toBe(true);
  });

  it('a more specific override always beats a less specific one under most-specific-wins', () => {
    const definition = makeDefinition({ precedence: 'most-specific-wins' });
    const values = [
      makeValue(PLATFORM, 'platform-value'),
      makeValue(PORTAL, 'portal-value'),
      makeValue(ORG, 'org-value'),
      makeValue(USER, 'user-value'),
    ];
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values });

    expect(entry.value).toBe('user-value');
    expect(entry.source).toEqual(USER);
  });
});

describe('resolveEffectiveConfig — precedence: both directions (S4 AC3)', () => {
  it("most-specific-wins (the contract's default): the user's value beats the org's", () => {
    const definition = makeDefinition({ precedence: 'most-specific-wins' });
    const values = [makeValue(ORG, 'org-value'), makeValue(USER, 'user-value')];
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values });

    expect(entry.value).toBe('user-value');
    expect(entry.source).toEqual(USER);
  });

  it('least-specific-wins: the platform value wins over a user value (S4 AC3 edge case)', () => {
    const definition = makeDefinition({ precedence: 'least-specific-wins' });
    const values = [makeValue(PLATFORM, 'platform-value'), makeValue(USER, 'user-value')];
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values });

    expect(entry.value).toBe('platform-value');
    expect(entry.source).toEqual(PLATFORM);
  });

  it("least-specific-wins: the org's value beats the user's", () => {
    const definition = makeDefinition({ precedence: 'least-specific-wins' });
    const values = [makeValue(ORG, 'org-value'), makeValue(USER, 'user-value')];
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values });

    expect(entry.value).toBe('org-value');
    expect(entry.source).toEqual(ORG);
  });

  it('least-specific-wins still falls back to default when nothing is set', () => {
    const definition = makeDefinition({ precedence: 'least-specific-wins' });
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values: [] });

    expect(entry.value).toBe('default-value');
  });
});

describe('resolveEffectiveConfig — lock short-circuit (S4 AC2), separate from precedence', () => {
  it('a portal-level lock beats org/user rows beneath it, regardless of precedence', () => {
    const definition = makeDefinition({ precedence: 'most-specific-wins' });
    const values = [
      makeValue(PORTAL, 'portal-locked-value', { isLocked: true, lockReason: 'compliance' }),
      makeValue(ORG, 'org-value'),
      makeValue(USER, 'user-value'),
    ];
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values });

    expect(entry.value).toBe('portal-locked-value');
    expect(entry.locked).toBe(true);
    expect(entry.lockedBy).toEqual(PORTAL);
    expect(entry.lockReason).toBe('compliance');
    expect(entry.editable).toBe(false);
  });

  it('the lock wins under least-specific-wins too — locking is not the precedence mechanism', () => {
    const definition = makeDefinition({ precedence: 'least-specific-wins' });
    const values = [
      makeValue(ORG, 'org-locked-value', { isLocked: true }),
      makeValue(USER, 'user-value'),
    ];
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values });

    // Under least-specific-wins the org would already beat the user on
    // precedence alone; the point of this test is that locking is a SEPARATE
    // mechanism that would win even if precedence pointed the other way (see
    // the sibling test below for that half).
    expect(entry.value).toBe('org-locked-value');
    expect(entry.locked).toBe(true);
    expect(entry.lockedBy).toEqual(ORG);
  });

  it('a lock at a MORE specific tier than precedence would naturally pick still wins', () => {
    // most-specific-wins would naturally pick the user's row; a user-level
    // lock still wins — but this asserts the OUTERMOST case below is the
    // interesting one, not "whichever tier precedence already preferred".
    const definition = makeDefinition({ precedence: 'most-specific-wins' });
    const values = [makeValue(ORG, 'org-value'), makeValue(USER, 'user-locked-value', { isLocked: true })];
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values });

    expect(entry.value).toBe('user-locked-value');
    expect(entry.lockedBy).toEqual(USER);
  });

  it('when MULTIPLE tiers are locked, the OUTERMOST (least specific) one wins', () => {
    const definition = makeDefinition({ precedence: 'most-specific-wins' });
    const values = [
      makeValue(PORTAL, 'portal-locked-value', { isLocked: true }),
      makeValue(ORG, 'org-locked-value', { isLocked: true }),
      makeValue(USER, 'user-value'),
    ];
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values });

    // Portal is "outer" relative to org (org is beneath portal in the chain),
    // so portal's lock beats org's lock even though org is also locked.
    expect(entry.value).toBe('portal-locked-value');
    expect(entry.lockedBy).toEqual(PORTAL);
  });

  it('a platform-level lock beats every tier beneath it', () => {
    const definition = makeDefinition();
    const values = [
      makeValue(PLATFORM, 'platform-locked-value', { isLocked: true }),
      makeValue(PORTAL, 'portal-value'),
      makeValue(ORG, 'org-value'),
      makeValue(USER, 'user-value'),
    ];
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values });

    expect(entry.value).toBe('platform-locked-value');
    expect(entry.lockedBy).toEqual(PLATFORM);
    expect(entry.editable).toBe(false);
  });
});

describe('resolveEffectiveConfig — provenance shape', () => {
  it('every entry carries key/value/source/locked/lockedBy/editable/definition', () => {
    const definition = makeDefinition();
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values: [] });

    expect(entry).toEqual(
      expect.objectContaining({
        key: definition.key,
        value: expect.anything(),
        source: expect.objectContaining({ scopeType: expect.any(String) }),
        locked: expect.any(Boolean),
        lockedBy: null,
        lockReason: null,
        editable: expect.any(Boolean),
        warning: null,
        definition,
      }),
    );
  });

  it('editable is false when the definition is isReadonly, even unlocked', () => {
    const definition = makeDefinition({ isReadonly: true });
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values: [] });

    expect(entry.locked).toBe(false);
    expect(entry.editable).toBe(false);
  });

  it("editable is false when the target scope isn't in allowedScopes", () => {
    const definition = makeDefinition({ allowedScopes: ['platform', 'portal', 'org'] }); // no 'user'
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values: [] });

    expect(entry.editable).toBe(false);
  });

  it('editable considers the LAST link of the chain (the scope being read), not an ancestor', () => {
    const definition = makeDefinition({ allowedScopes: ['org'] }); // not 'user'
    const orgOnlyChain: Scope[] = [PLATFORM, PORTAL, ORG];
    const [entry] = resolveEffectiveConfig({ chain: orgOnlyChain, definitions: [definition], values: [] });

    expect(entry.editable).toBe(true);
  });
});

describe('resolveEffectiveConfig — isHidden keys are omitted entirely', () => {
  it('never returns an entry for an isHidden key', () => {
    const visible = makeDefinition({ key: 'visible.key' });
    const hidden = makeDefinition({
      key: 'hidden.key',
      id: 'ckd_hidden00000000000000000' as KeyDefinition['id'],
      isHidden: true,
    });
    const entries = resolveEffectiveConfig({
      chain: FULL_CHAIN,
      definitions: [visible, hidden],
      values: [],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('visible.key');
    expect(entries.some((e) => e.key === 'hidden.key')).toBe(false);
  });
});

describe('resolveEffectiveConfig — isSecret keys never return their value', () => {
  it('value is always null for a secret key; isSet reflects whether an override exists', () => {
    const definition = makeDefinition({ valueType: 'secret', isSecret: true, defaultValue: null });
    const values = [makeValue(USER, 'super-secret-token')];
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values });

    expect(entry.value).toBeNull();
    expect(entry.isSet).toBe(true);
  });

  it('isSet is false when a secret key has no stored override anywhere', () => {
    const definition = makeDefinition({ valueType: 'secret', isSecret: true, defaultValue: null });
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values: [] });

    expect(entry.value).toBeNull();
    expect(entry.isSet).toBe(false);
  });

  it('isSet is omitted (undefined) for a non-secret key', () => {
    const definition = makeDefinition({ isSecret: false });
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values: [] });

    expect(entry.isSet).toBeUndefined();
  });
});

describe('resolveEffectiveConfig — stale stored value (S4 AC4)', () => {
  it('falls back to the default with a warning when a stored value fails its (now-changed) schema', () => {
    // enumValues changed after the org's value was written; 'legacy-value' is
    // no longer a member.
    const definition = makeDefinition({
      valueType: 'enum',
      enumValues: ['a', 'b', 'c'],
      defaultValue: 'a',
    });
    const values = [makeValue(ORG, 'legacy-value')];
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values });

    expect(entry.value).toBe('a'); // the default, not the stale stored value
    expect(entry.warning).toEqual(expect.stringContaining('no longer satisfies'));
  });

  it('does NOT fail the whole resolution — every other key still resolves normally', () => {
    const stale = makeDefinition({
      key: 'stale.key',
      id: 'ckd_stale000000000000000000' as KeyDefinition['id'],
      valueType: 'enum',
      enumValues: ['a', 'b'],
      defaultValue: 'a',
    });
    const healthy = makeDefinition({ key: 'healthy.key', id: 'ckd_healthy0000000000000000' as KeyDefinition['id'] });
    const values = [
      { ...makeValue(ORG, 'not-in-enum'), definitionId: stale.id },
      { ...makeValue(ORG, 'fine'), definitionId: healthy.id },
    ];
    const entries = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [stale, healthy], values });

    const staleEntry = entries.find((e) => e.key === 'stale.key')!;
    const healthyEntry = entries.find((e) => e.key === 'healthy.key')!;
    expect(staleEntry.warning).not.toBeNull();
    expect(staleEntry.value).toBe('a');
    expect(healthyEntry.warning).toBeNull();
    expect(healthyEntry.value).toBe('fine');
  });

  it('a valid stored value produces no warning', () => {
    const definition = makeDefinition({ valueType: 'enum', enumValues: ['a', 'b'], defaultValue: 'a' });
    const values = [makeValue(ORG, 'b')];
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values });

    expect(entry.warning).toBeNull();
    expect(entry.value).toBe('b');
  });
});

describe('resolveEffectiveConfig — chain assembly is the caller\'s job', () => {
  it('ignores values outside the supplied chain (a sibling org, for example)', () => {
    const definition = makeDefinition();
    const otherOrg: Scope = { scopeType: 'org', scopeId: 'org_2' };
    const values = [makeValue(otherOrg, 'other-org-value')];
    const [entry] = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [definition], values });

    // org_2's row is irrelevant to a chain resolving org_1 — falls through to default.
    expect(entry.value).toBe('default-value');
  });

  it('throws on an empty chain — there is no scope to resolve for', () => {
    expect(() =>
      resolveEffectiveConfig({ chain: [], definitions: [makeDefinition()], values: [] }),
    ).toThrow();
  });

  it('returns no entries when there are no definitions', () => {
    const entries = resolveEffectiveConfig({ chain: FULL_CHAIN, definitions: [], values: [] });
    expect(entries).toEqual([]);
  });
});
