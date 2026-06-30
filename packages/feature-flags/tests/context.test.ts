import { toEvaluationContext } from '../src/context';

describe('toEvaluationContext', () => {
  it('maps userId -> targetingKey', () => {
    const ctx = toEvaluationContext({ userId: 'user-42' });
    expect(ctx.targetingKey).toBe('user-42');
    expect('userId' in ctx).toBe(false);
  });

  it('passes environment, orgId, tenantId, app through as custom fields with exact keys', () => {
    const ctx = toEvaluationContext({
      environment: 'production',
      orgId: 'org-1',
      tenantId: 'tenant-1',
      app: 'task-manager',
      userId: 'u1',
    });
    expect(ctx).toMatchObject({
      targetingKey: 'u1',
      environment: 'production',
      orgId: 'org-1',
      tenantId: 'tenant-1',
      app: 'task-manager',
    });
  });

  it('preserves primitive extra fields and stringifies non-primitives', () => {
    const ctx = toEvaluationContext({
      count: 5,
      enabled: true,
      nested: { a: 1 } as unknown,
    });
    expect(ctx.count).toBe(5);
    expect(ctx.enabled).toBe(true);
    expect(typeof ctx.nested).toBe('string');
  });

  it('drops undefined/null values', () => {
    const ctx = toEvaluationContext({
      userId: undefined,
      orgId: undefined,
      app: 'x',
    });
    expect('targetingKey' in ctx).toBe(false);
    expect('orgId' in ctx).toBe(false);
    expect(ctx.app).toBe('x');
  });

  it('returns an empty context when no input is given', () => {
    expect(toEvaluationContext()).toEqual({});
  });
});
