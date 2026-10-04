import {
  SCHEMA_BY_TOPIC,
  schemaForTopic,
  partitionKeyForPayload,
  TOPICS,
} from '../../src/kafka';

describe('SCHEMA_BY_TOPIC / schemaForTopic', () => {
  it('resolves the lifecycle topics to a validating schema', () => {
    const lifecycle = [
      TOPICS.IDENTITY_ORG_CREATED,
      TOPICS.IDENTITY_ORG_UPDATED,
      TOPICS.IDENTITY_ORG_DELETED,
      TOPICS.IDENTITY_USER_UPDATED,
      TOPICS.IDENTITY_USER_DELETED,
      TOPICS.IDENTITY_MEMBERSHIP_ADDED,
      TOPICS.IDENTITY_MEMBERSHIP_REMOVED,
    ];
    for (const topic of lifecycle) {
      const schema = schemaForTopic(topic);
      expect(schema).toBeDefined();
      // the resolved schema actually validates its payload family
      expect(typeof schema!.safeParse).toBe('function');
    }
  });

  it('returns undefined for an unmapped topic (raw publish path)', () => {
    expect(schemaForTopic('billing.trial.ending')).toBeUndefined();
    expect(schemaForTopic('not.a.topic')).toBeUndefined();
  });

  it('every registered key is a known topic value', () => {
    const topicValues = new Set<string>(Object.values(TOPICS));
    for (const key of Object.keys(SCHEMA_BY_TOPIC)) {
      expect(topicValues.has(key)).toBe(true);
    }
  });

  it('the org.created schema resolved via the registry rejects a bad payload', () => {
    const schema = schemaForTopic(TOPICS.IDENTITY_ORG_CREATED)!;
    expect(schema.safeParse({ organizationId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('partitionKeyForPayload', () => {
  it('prefers organizationId, then userId, then portalId', () => {
    expect(partitionKeyForPayload({ organizationId: 'o1', userId: 'u1' })).toBe('o1');
    expect(partitionKeyForPayload({ userId: 'u1', portalId: 'p1' })).toBe('u1');
    expect(partitionKeyForPayload({ portalId: 'p1' })).toBe('p1');
    expect(partitionKeyForPayload({ entityId: 'e1' })).toBe('e1');
  });

  it('returns undefined when no id field is present', () => {
    expect(partitionKeyForPayload({ foo: 'bar' })).toBeUndefined();
    expect(partitionKeyForPayload(null)).toBeUndefined();
  });
});

describe('config.changed (FF-EPIC-18-S4)', () => {
  const { configChangedSchemaV1 } = require('../../src/kafka');
  const valid = {
    namespace: 'fuzefront.chat',
    scope: { scopeType: 'org', scopeId: '550e8400-e29b-41d4-a716-446655440000' },
    changedKeys: ['ui.theme.density', 'api.key'],
  };

  it('is registered under TOPICS.CONFIG_CHANGED', () => {
    expect(TOPICS.CONFIG_CHANGED).toBe('config.changed');
    expect(schemaForTopic(TOPICS.CONFIG_CHANGED)).toBe(configChangedSchemaV1);
  });

  it('accepts a coalesced key list, and platform scope with null scopeId', () => {
    expect(() => configChangedSchemaV1.parse(valid)).not.toThrow();
    expect(() =>
      configChangedSchemaV1.parse({ ...valid, scope: { scopeType: 'platform', scopeId: null } }),
    ).not.toThrow();
  });

  it('rejects an empty key list and unknown scope types', () => {
    expect(() => configChangedSchemaV1.parse({ ...valid, changedKeys: [] })).toThrow();
    expect(() =>
      configChangedSchemaV1.parse({ ...valid, scope: { scopeType: 'galaxy', scopeId: 'x' } }),
    ).toThrow();
  });

  it('is strict: a value-bearing field can never ride along', () => {
    expect(() => configChangedSchemaV1.parse({ ...valid, newValue: 'hunter2' })).toThrow();
    expect(() => configChangedSchemaV1.parse({ ...valid, values: { a: 1 } })).toThrow();
  });
});
