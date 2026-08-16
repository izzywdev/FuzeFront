import { computeResolvedVersion } from '../../src/services/version';
import { ConfigValue } from '../../src/types';

function row(id: string, updatedAt: string): ConfigValue {
  return {
    id,
    definitionId: 'ckd_x' as any,
    scopeType: 'org',
    scopeId: 'org_x',
    value: 'v',
    isLocked: false,
    lockReason: null,
    setByUserId: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('computeResolvedVersion', () => {
  it('is deterministic for the same rows regardless of input order', () => {
    const rows = [row('a', '2026-01-01T00:00:00.000Z'), row('b', '2026-01-02T00:00:00.000Z')];
    const v1 = computeResolvedVersion(rows);
    const v2 = computeResolvedVersion([rows[1], rows[0]]);
    expect(v1).toBe(v2);
  });

  it('changes when any row updatedAt changes', () => {
    const before = [row('a', '2026-01-01T00:00:00.000Z')];
    const after = [row('a', '2026-01-01T00:00:01.000Z')];
    expect(computeResolvedVersion(before)).not.toBe(computeResolvedVersion(after));
  });

  it('changes when a row is added (e.g. an ancestor sets a new override)', () => {
    const before = [row('a', '2026-01-01T00:00:00.000Z')];
    const after = [row('a', '2026-01-01T00:00:00.000Z'), row('b', '2026-01-02T00:00:00.000Z')];
    expect(computeResolvedVersion(before)).not.toBe(computeResolvedVersion(after));
  });

  it('is a stable, defined value for an empty (all-defaults) set', () => {
    expect(computeResolvedVersion([])).toEqual(computeResolvedVersion([]));
    expect(typeof computeResolvedVersion([])).toBe('string');
  });
});
