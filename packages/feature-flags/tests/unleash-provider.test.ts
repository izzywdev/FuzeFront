import { toUnleashContext } from '../src/unleash-provider';

/**
 * The `developers` segment constrains Unleash's BUILT-IN `userId` field. The
 * chain is: caller `userId` -> OpenFeature `targetingKey` -> Unleash `userId`.
 * If the last hop regresses, the segment silently matches nobody and every
 * developer-targeted flag reads as OFF — with no error anywhere. These tests
 * pin that hop.
 */
describe('toUnleashContext', () => {
  it('maps targetingKey onto the built-in userId (what the segment constrains)', () => {
    const ctx = toUnleashContext({
      targetingKey: '9aed7c94-dcf7-4dd8-b5d9-f6236c6546bd',
    });
    expect(ctx.userId).toBe('9aed7c94-dcf7-4dd8-b5d9-f6236c6546bd');
  });

  it('passes Unleash built-in fields through at the top level, not under properties', () => {
    const ctx = toUnleashContext({
      targetingKey: 'u-1',
      environment: 'prod',
      appName: 'fuzefront-host',
      sessionId: 's-1',
    });
    expect(ctx.environment).toBe('prod');
    expect(ctx.appName).toBe('fuzefront-host');
    expect(ctx.sessionId).toBe('s-1');
    expect(ctx.properties).toEqual({});
  });

  it('routes custom fields into properties so constraints can target them', () => {
    const ctx = toUnleashContext({ targetingKey: 'u-1', orgId: 'org-7', app: 'host' });
    expect(ctx.properties).toEqual({ orgId: 'org-7', app: 'host' });
    // Custom fields must NOT leak to the top level, where Unleash ignores them.
    expect(ctx.orgId).toBeUndefined();
  });

  it('drops null/undefined rather than stringifying them to "null"', () => {
    const ctx = toUnleashContext({ targetingKey: 'u-1', orgId: null as any, tenantId: undefined });
    expect(ctx.properties).toEqual({});
  });

  it('returns an empty properties bag for no context (never throws)', () => {
    expect(toUnleashContext(undefined)).toEqual({ properties: {} });
  });

  it('coerces non-string primitives to strings for properties', () => {
    const ctx = toUnleashContext({ targetingKey: 'u-1', seats: 5, beta: true });
    expect(ctx.properties).toEqual({ seats: '5', beta: 'true' });
  });
});
