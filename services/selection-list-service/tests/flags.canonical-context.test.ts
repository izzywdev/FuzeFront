// flags.canonical-context.test.ts - ONE canonical flag-evaluation context for the same org.
//
// The seeding paths hold the org as its wire TypeID (`org_...`); the HTTP paths used to pass the raw JWT
// claim (a TypeID OR a bare UUID). An Unleash `orgId` constraint could then match one path and not the
// other. The canonical form is the wire TypeID: every path must evaluate the SAME context for the same org.

import type { NextFunction, Request, Response } from 'express';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { FLAGS, buildFlagContext, isSeedDefaultsEnabled, isSelectionListsEnabled, setFlagClient } from '../src/flags';
import { requireSelectionListsFlag } from '../src/middleware/flagGate';
import { isSeedingEnabled } from '../src/seed/flagGate';
import { canonicalFlagOrgId, canonicalFlagUserId } from '../src/lib/flagIdentity';

const ORG_UUID = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d00';
const ORG_WIRE = fromUuid('organization', ORG_UUID);
const USER_UUID = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d01';
const USER_WIRE = fromUuid('user', USER_UUID);

interface Seen {
  key: string;
  ctx: Record<string, unknown>;
}
let seen: Seen[] = [];

beforeEach(() => {
  seen = [];
  setFlagClient({
    getBooleanValue: async (key: string, _def: boolean, ctx?: Record<string, unknown>) => {
      seen.push({ key, ctx: ctx ?? {} });
      return true;
    },
  });
});
afterEach(() => setFlagClient(null));

describe('canonical flag identity', () => {
  it('a bare UUID becomes the wire TypeID; a TypeID is untouched; anything else passes through (never throws)', () => {
    expect(canonicalFlagOrgId(ORG_UUID)).toBe(ORG_WIRE);
    expect(canonicalFlagOrgId(ORG_UUID.toUpperCase())).toBe(ORG_WIRE);
    expect(canonicalFlagOrgId(ORG_WIRE)).toBe(ORG_WIRE);
    expect(canonicalFlagOrgId('some-opaque-org')).toBe('some-opaque-org');
    expect(canonicalFlagUserId(USER_UUID)).toBe(USER_WIRE);
    expect(canonicalFlagUserId(USER_WIRE)).toBe(USER_WIRE);
    expect(canonicalFlagUserId('legacy-user')).toBe('legacy-user');
  });

  it('buildFlagContext maps organizationId -> orgId (canonical) and userId (canonical), app + environment always set', () => {
    expect(buildFlagContext({ organizationId: ORG_UUID, userId: USER_UUID })).toMatchObject({
      orgId: ORG_WIRE,
      userId: USER_WIRE,
      app: 'selection-list-service',
    });
    expect(buildFlagContext({})).not.toHaveProperty('orgId');
  });
});

describe('both paths evaluate the SAME context for the same org', () => {
  const orgContexts = (): Array<Record<string, unknown>> => seen.map((s) => s.ctx);

  it('HTTP path with a bare-UUID JWT claim == HTTP path with a TypeID claim == seeding path with the wire id (master gate)', async () => {
    await isSelectionListsEnabled({ organizationId: ORG_UUID, userId: USER_UUID }); // JWT claim: bare UUID
    await isSelectionListsEnabled({ organizationId: ORG_WIRE, userId: USER_WIRE }); // JWT claim: TypeID
    await isSeedingEnabled(ORG_WIRE); // seeding path (org-created / reconciler / seed-requested)
    const [uuidClaim, typeIdClaim, ...seeding] = orgContexts();
    expect(uuidClaim.orgId).toBe(ORG_WIRE);
    expect(typeIdClaim.orgId).toBe(ORG_WIRE);
    expect(seeding.length).toBe(2); // master gate + seed flag
    for (const c of seeding) expect(c.orgId).toBe(ORG_WIRE);
    // identical org targeting key across all of them
    expect(new Set(orgContexts().map((c) => c.orgId))).toEqual(new Set([ORG_WIRE]));
    // and the same user form for the two HTTP evaluations
    expect(uuidClaim.userId).toBe(typeIdClaim.userId);
  });

  it('the seed-defaults flag is evaluated with the identical org context from a UUID-keyed and a TypeID-keyed caller', async () => {
    await isSeedDefaultsEnabled({ organizationId: ORG_UUID });
    await isSeedDefaultsEnabled({ organizationId: ORG_WIRE });
    const [a, b] = seen;
    expect(a.key).toBe(FLAGS.SELECTION_LISTS_SEED_DEFAULTS);
    expect(a.ctx).toEqual(b.ctx);
  });

  it('the real HTTP gate middleware (requireSelectionListsFlag) canonicalises a bare-UUID req.orgId', async () => {
    const req = { orgId: ORG_UUID, userId: USER_UUID, headers: {} } as unknown as Request;
    const res = {} as Response;
    const next = jest.fn() as unknown as NextFunction;
    await requireSelectionListsFlag(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0].ctx).toMatchObject({ orgId: ORG_WIRE, userId: USER_WIRE });

    // ... and what the seeding path evaluates for the same org is the same targeting context.
    await isSelectionListsEnabled({ organizationId: ORG_WIRE });
    expect(seen[1].ctx.orgId).toBe(seen[0].ctx.orgId);
  });
});
