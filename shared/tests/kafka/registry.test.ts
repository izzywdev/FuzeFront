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
