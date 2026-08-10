import {
  identityOrgCreatedSchemaV1,
  identityOrgUpdatedSchemaV1,
  identityOrgDeletedSchemaV1,
  identityUserUpdatedSchemaV1,
  identityUserDeletedSchemaV1,
  identityMembershipAddedSchemaV1,
  identityMembershipRemovedSchemaV1,
  TOPICS,
} from '../../src/kafka';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440001';
const PARENT_ID = '550e8400-e29b-41d4-a716-446655440002';

// ── identityOrgCreatedSchemaV1 / identityOrgUpdatedSchemaV1 (snapshot) ────────

describe('organization snapshot schema (created/updated)', () => {
  const valid = {
    organizationId: ORG_ID,
    slug: 'acme',
    name: 'Acme Inc',
    type: 'organization' as const,
    parentId: PARENT_ID,
    ownerId: USER_ID,
    isActive: true,
  };

  it('accepts a full snapshot on both created and updated', () => {
    expect(() => identityOrgCreatedSchemaV1.parse(valid)).not.toThrow();
    expect(() => identityOrgUpdatedSchemaV1.parse(valid)).not.toThrow();
  });

  it('accepts null parentId and ownerId (root/platform org)', () => {
    expect(() =>
      identityOrgCreatedSchemaV1.parse({ ...valid, parentId: null, ownerId: null, type: 'platform' }),
    ).not.toThrow();
  });

  it('accepts optional settings/metadata objects', () => {
    expect(() =>
      identityOrgCreatedSchemaV1.parse({ ...valid, settings: { a: 1 }, metadata: { b: 'x' } }),
    ).not.toThrow();
  });

  it('rejects a non-UUID organizationId', () => {
    expect(() => identityOrgCreatedSchemaV1.parse({ ...valid, organizationId: 'nope' })).toThrow();
  });

  it('rejects an invalid type', () => {
    expect(() => identityOrgCreatedSchemaV1.parse({ ...valid, type: 'team' })).toThrow();
  });

  it('does NOT carry a cascade field (that is delete-only)', () => {
    // extra keys are stripped by zod objects, so presence must not be required
    expect(() => identityOrgCreatedSchemaV1.parse({ ...valid, cascade: 'soft' })).not.toThrow();
  });
});

// ── identityOrgDeletedSchemaV1 ───────────────────────────────────────────────

describe('identityOrgDeletedSchemaV1', () => {
  const valid = { organizationId: ORG_ID, slug: 'acme', ownerId: USER_ID, cascade: 'soft' as const };

  it('accepts a soft delete', () => {
    expect(() => identityOrgDeletedSchemaV1.parse(valid)).not.toThrow();
  });

  it('accepts a hard delete with null owner', () => {
    expect(() =>
      identityOrgDeletedSchemaV1.parse({ ...valid, cascade: 'hard', ownerId: null }),
    ).not.toThrow();
  });

  it('rejects an unknown cascade value', () => {
    expect(() => identityOrgDeletedSchemaV1.parse({ ...valid, cascade: 'archive' })).toThrow();
  });
});

// ── identityUserUpdatedSchemaV1 / identityUserDeletedSchemaV1 ─────────────────

describe('identity user update/delete schemas', () => {
  it('accepts a user update with optional fields omitted', () => {
    expect(() =>
      identityUserUpdatedSchemaV1.parse({ userId: USER_ID, email: 'a@b.com' }),
    ).not.toThrow();
  });

  it('accepts a null homePortalId on update', () => {
    expect(() =>
      identityUserUpdatedSchemaV1.parse({ userId: USER_ID, email: 'a@b.com', homePortalId: null }),
    ).not.toThrow();
  });

  it('rejects a malformed email on update', () => {
    expect(() =>
      identityUserUpdatedSchemaV1.parse({ userId: USER_ID, email: 'not-an-email' }),
    ).toThrow();
  });

  it('accepts a user delete and rejects a bad cascade', () => {
    expect(() =>
      identityUserDeletedSchemaV1.parse({ userId: USER_ID, email: 'a@b.com', cascade: 'hard' }),
    ).not.toThrow();
    expect(() =>
      identityUserDeletedSchemaV1.parse({ userId: USER_ID, email: 'a@b.com', cascade: 'nope' }),
    ).toThrow();
  });
});

// ── membership schemas ───────────────────────────────────────────────────────

describe('membership added/removed schemas', () => {
  const valid = { organizationId: ORG_ID, userId: USER_ID, role: 'owner' };

  it('accepts a valid membership change on both added and removed', () => {
    expect(() => identityMembershipAddedSchemaV1.parse(valid)).not.toThrow();
    expect(() => identityMembershipRemovedSchemaV1.parse(valid)).not.toThrow();
  });

  it('rejects a non-UUID userId', () => {
    expect(() => identityMembershipAddedSchemaV1.parse({ ...valid, userId: 'x' })).toThrow();
  });
});

// ── TOPICS constants ─────────────────────────────────────────────────────────

describe('TOPICS identity lifecycle constants', () => {
  it('exposes the new org/user/membership lifecycle topics', () => {
    expect(TOPICS.IDENTITY_ORG_CREATED).toBe('identity.org.created');
    expect(TOPICS.IDENTITY_ORG_UPDATED).toBe('identity.org.updated');
    expect(TOPICS.IDENTITY_ORG_DELETED).toBe('identity.org.deleted');
    expect(TOPICS.IDENTITY_USER_UPDATED).toBe('identity.user.updated');
    expect(TOPICS.IDENTITY_USER_DELETED).toBe('identity.user.deleted');
    expect(TOPICS.IDENTITY_MEMBERSHIP_ADDED).toBe('identity.membership.added');
    expect(TOPICS.IDENTITY_MEMBERSHIP_REMOVED).toBe('identity.membership.removed');
  });
});
