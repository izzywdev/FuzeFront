import { buildWriteChain, findAncestorLock, findRowAtTargetScope } from '../../src/services/scope-chain';
import { ConfigValue, Scope } from '../../src/types';

function row(partial: Partial<ConfigValue> & Pick<ConfigValue, 'scopeType' | 'scopeId'>): ConfigValue {
  return {
    id: 'v1',
    definitionId: 'ckd_x' as any,
    value: 'x',
    isLocked: false,
    lockReason: null,
    setByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('buildWriteChain', () => {
  it('is just [platform] when the target IS platform', () => {
    expect(buildWriteChain({ scopeType: 'platform', scopeId: null }, {})).toEqual([
      { scopeType: 'platform', scopeId: null },
    ]);
  });

  it('appends the target as the last element for a portal write, no separate portal ancestor', () => {
    const target: Scope = { scopeType: 'portal', scopeId: 'p1' };
    expect(buildWriteChain(target, { portalId: 'p1' })).toEqual([
      { scopeType: 'platform', scopeId: null },
      { scopeType: 'portal', scopeId: 'p1' },
    ]);
  });

  it('includes the portal ancestor from principal context for an org write', () => {
    const target: Scope = { scopeType: 'org', scopeId: 'o1' };
    expect(buildWriteChain(target, { portalId: 'p1' })).toEqual([
      { scopeType: 'platform', scopeId: null },
      { scopeType: 'portal', scopeId: 'p1' },
      { scopeType: 'org', scopeId: 'o1' },
    ]);
  });

  it('omits the portal ancestor entirely when the principal carries no portalId (documented limitation)', () => {
    const target: Scope = { scopeType: 'org', scopeId: 'o1' };
    expect(buildWriteChain(target, {})).toEqual([
      { scopeType: 'platform', scopeId: null },
      { scopeType: 'org', scopeId: 'o1' },
    ]);
  });

  it('includes portal + org ancestors for a user write when both are known', () => {
    const target: Scope = { scopeType: 'user', scopeId: 'u1' };
    expect(buildWriteChain(target, { portalId: 'p1', orgId: 'o1' })).toEqual([
      { scopeType: 'platform', scopeId: null },
      { scopeType: 'portal', scopeId: 'p1' },
      { scopeType: 'org', scopeId: 'o1' },
      { scopeType: 'user', scopeId: 'u1' },
    ]);
  });
});

describe('findAncestorLock', () => {
  it('returns null when no ancestor tier is locked', () => {
    const chain: Scope[] = [
      { scopeType: 'platform', scopeId: null },
      { scopeType: 'org', scopeId: 'o1' },
    ];
    const rows = [row({ scopeType: 'platform', scopeId: null, isLocked: false })];
    expect(findAncestorLock(chain, rows)).toBeNull();
  });

  it('finds a platform lock as the outermost ancestor', () => {
    const chain: Scope[] = [
      { scopeType: 'platform', scopeId: null },
      { scopeType: 'org', scopeId: 'o1' },
    ];
    const rows = [row({ scopeType: 'platform', scopeId: null, isLocked: true })];
    expect(findAncestorLock(chain, rows)).toEqual({ scopeType: 'platform', scopeId: null });
  });

  it('finds a portal lock blocking an org write beneath it (S6 AC4 example)', () => {
    const chain: Scope[] = [
      { scopeType: 'platform', scopeId: null },
      { scopeType: 'portal', scopeId: 'p1' },
      { scopeType: 'org', scopeId: 'o1' },
    ];
    const rows = [
      row({ scopeType: 'platform', scopeId: null, isLocked: false }),
      row({ scopeType: 'portal', scopeId: 'p1', isLocked: true }),
    ];
    expect(findAncestorLock(chain, rows)).toEqual({ scopeType: 'portal', scopeId: 'p1' });
  });

  it('ignores a lock AT the target scope itself (only ancestors count)', () => {
    const chain: Scope[] = [
      { scopeType: 'platform', scopeId: null },
      { scopeType: 'org', scopeId: 'o1' },
    ];
    const rows = [row({ scopeType: 'org', scopeId: 'o1', isLocked: true })];
    expect(findAncestorLock(chain, rows)).toBeNull();
  });

  it('picks the OUTERMOST lock when multiple ancestor tiers are locked', () => {
    const chain: Scope[] = [
      { scopeType: 'platform', scopeId: null },
      { scopeType: 'portal', scopeId: 'p1' },
      { scopeType: 'org', scopeId: 'o1' },
      { scopeType: 'user', scopeId: 'u1' },
    ];
    const rows = [
      row({ scopeType: 'portal', scopeId: 'p1', isLocked: true }),
      row({ scopeType: 'org', scopeId: 'o1', isLocked: true }),
    ];
    expect(findAncestorLock(chain, rows)).toEqual({ scopeType: 'portal', scopeId: 'p1' });
  });

  it('matches rows to chain tiers by scopeType alone (robust to wire-form vs legacy scopeId mismatches)', () => {
    const chain: Scope[] = [
      { scopeType: 'platform', scopeId: null },
      { scopeType: 'org', scopeId: '11111111-1111-7111-8111-111111111111' }, // legacy bare uuid on the chain
      { scopeType: 'user', scopeId: 'usr_abc' },
    ];
    // Stored row renders scopeId in prefixed wire form (org_...), NOT the bare uuid on the chain.
    const rows = [row({ scopeType: 'org', scopeId: 'org_01h455vb4pex5vsknk084sn02q', isLocked: true })];
    expect(findAncestorLock(chain, rows)).toEqual(chain[1]);
  });
});

describe('findRowAtTargetScope', () => {
  it('returns the row matching the LAST chain entry by scopeType', () => {
    const chain: Scope[] = [
      { scopeType: 'platform', scopeId: null },
      { scopeType: 'org', scopeId: 'o1' },
    ];
    const target = row({ scopeType: 'org', scopeId: 'o1', value: 'target-value' });
    const rows = [row({ scopeType: 'platform', scopeId: null, value: 'platform-value' }), target];
    expect(findRowAtTargetScope(chain, rows)).toBe(target);
  });

  it('returns undefined when nothing is set at the target scope', () => {
    const chain: Scope[] = [{ scopeType: 'platform', scopeId: null }, { scopeType: 'org', scopeId: 'o1' }];
    expect(findRowAtTargetScope(chain, [])).toBeUndefined();
  });
});
