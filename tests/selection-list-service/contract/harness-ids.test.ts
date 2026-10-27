/**
 * Self-check of the harness's fixture ids (helpers/ids.ts) and of the stand-in Security API's id
 * canonicalisation. No service is involved for the first block; the second talks to the stand-in only.
 *
 * Why this exists: a service that names tenants and users to the Security API by their bare UUID refuses
 * an id that is not codec-valid. A hand-typed `org_01test…` literal creeping back into a suite would then
 * fail only as an opaque 403 cascade; these assertions make that failure legible and local.
 */
import { fromUuid, parseId, toUuid } from '@izzywdev/fuzefront-identity';
import { canonicalUuid, renderingsOf, sameId, testOrg, testUser, uuidsOf } from '../helpers/ids';
import { FAKE_SECURITY_URL, newOrg, newUser } from '../helpers/shared-lists';
import { DEACTIVATED_PLATFORM_ORG_ID, DECOY_PLATFORM_ORG_ID, PLATFORM_ORG_ID, SUSPENDABLE_PLATFORM_ORG_ID, UNCONFIRMED_PLATFORM_ORG_ID } from '../helpers/sl9-constants';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

describe('harness fixture ids are codec-valid and deterministic', () => {
  it('testOrg / testUser mint ids the identity codec accepts, of the right type', () => {
    expect(() => parseId('organization', testOrg('x'))).not.toThrow();
    expect(() => parseId('user', testUser('x'))).not.toThrow();
    expect(() => parseId('user', testOrg('x'))).toThrow(); // cross-type confusion is still refused
    expect(() => parseId('organization', testUser('x'))).toThrow();
  });

  it('the same tag names the same id every time; different tags and types never collide', () => {
    expect(testOrg('a')).toBe(testOrg('a'));
    expect(testOrg('a')).not.toBe(testOrg('b'));
    expect(canonicalUuid(testOrg('a'))).not.toBe(canonicalUuid(testUser('a')));
  });

  it('newOrg / newUser (per-run ids) are codec-valid and unique per call', () => {
    const [o1, o2, u1, u2] = [newOrg('t'), newOrg('t'), newUser('t'), newUser('t')];
    for (const o of [o1, o2]) expect(() => parseId('organization', o)).not.toThrow();
    for (const u of [u1, u2]) expect(() => parseId('user', u)).not.toThrow();
    expect(o1).not.toBe(o2);
    expect(u1).not.toBe(u2);
  });

  it('canonicalUuid maps a TypeID and its bare UUID to the same value, and leaves non-user principals alone', () => {
    const typeId = testUser('canon');
    const uuid = toUuid(typeId as never);
    expect(canonicalUuid(typeId)).toBe(uuid);
    expect(canonicalUuid(uuid)).toBe(uuid);
    expect(canonicalUuid(uuid.toUpperCase())).toBe(uuid);
    expect(fromUuid('user', uuid)).toBe(typeId);
    expect(sameId(typeId, uuid)).toBe(true);
    expect(sameId(typeId, testUser('other'))).toBe(false);
    expect(uuidsOf([typeId, uuid])).toEqual([uuid, uuid]);
    for (const principal of ['svc:selection-list-service-ci', 'service:notifier', 'svc_token:abc123']) {
      expect(canonicalUuid(principal)).toBe(principal);
    }
  });

  it('the platform org is the id the service under test must be configured with (SELECTION_LIST_PLATFORM_ORG_ID)', () => {
    if (process.env['TEST_PLATFORM_ORG_ID']) return; // overridden on both sides
    expect(PLATFORM_ORG_ID).toBe('org_01jpmf4z1yf88rpb9z9sd6pz00');
    expect(() => parseId('organization', PLATFORM_ORG_ID)).not.toThrow();
  });
});

describe('the platform-org fixtures are codec-valid and the CI job configures the same ids', () => {
  it('every platform-org constant decodes as an organization id', () => {
    for (const id of [PLATFORM_ORG_ID, DECOY_PLATFORM_ORG_ID, UNCONFIRMED_PLATFORM_ORG_ID, DEACTIVATED_PLATFORM_ORG_ID, SUSPENDABLE_PLATFORM_ORG_ID]) {
      expect(() => parseId('organization', id)).not.toThrow();
      // the service refuses a SELECTION_LIST_PLATFORM_ORG_ID that is not in its canonical spelling (decode, re-encode, same string)
      expect(fromUuid('organization', toUuid(id as never))).toBe(id);
    }
    expect(new Set([PLATFORM_ORG_ID, DECOY_PLATFORM_ORG_ID, UNCONFIRMED_PLATFORM_ORG_ID, DEACTIVATED_PLATFORM_ORG_ID, SUSPENDABLE_PLATFORM_ORG_ID]).size).toBe(5);
  });

  it('.github/workflows/ci.yml starts the platform-disabled instances with exactly those ids', () => {
    // The ids are literals in the workflow (a service refuses a SELECTION_LIST_PLATFORM_ORG_ID that is not a
    // canonical TypeID, so a stale hand-typed value turns the whole job red at boot).
    const ci = resolvePath(__dirname, '../../../.github/workflows/ci.yml');
    expect(existsSync(ci)).toBe(true);
    const text = readFileSync(ci, 'utf8');
    expect(text).toContain(`PORT=3014 SELECTION_LIST_PLATFORM_ORG_ID=${UNCONFIRMED_PLATFORM_ORG_ID} `);
    expect(text).toContain(`PORT=3015 SELECTION_LIST_PLATFORM_ORG_ID=${DEACTIVATED_PLATFORM_ORG_ID} `);
    if (!process.env['TEST_PLATFORM_ORG_ID']) expect(text).toContain(`SELECTION_LIST_PLATFORM_ORG_ID: ${PLATFORM_ORG_ID}\n`);
  });

  it('.github/workflows/ci.yml starts the two SUSPENSION instances (3016 flags ON / 3017 shared-lists OFF) with the suspendable platform org, waits for them and hands the suites their URLs', () => {
    // The suspension suite deactivates and reactivates ITS platform org, so it must be nobody else's: a literal in the
    // workflow (the service refuses a value that is not a canonical TypeID), pinned to the harness constant.
    const text = readFileSync(resolvePath(__dirname, '../../../.github/workflows/ci.yml'), 'utf8');
    expect(text).toContain(`PORT=3016 SELECTION_LIST_PLATFORM_ORG_ID=${SUSPENDABLE_PLATFORM_ORG_ID} node `);
    expect(text).toContain(`PORT=3017 SELECTION_LIST_PLATFORM_ORG_ID=${SUSPENDABLE_PLATFORM_ORG_ID} FUZE_FLAGS_OFFLINE_ON=fuzefront.selection-lists.service node `);
    expect(text).toContain('PORTS="3011 3012 3013 3014 3015 3016 3017"');
    expect(text).toContain('SHARED_LISTS_SUSPENSION_URLS: on=http://localhost:3016,off=http://localhost:3017');
    // nobody else shares it: it is neither the configured platform org nor one of the trust-suite fixtures
    for (const other of [PLATFORM_ORG_ID, DECOY_PLATFORM_ORG_ID, UNCONFIRMED_PLATFORM_ORG_ID, DEACTIVATED_PLATFORM_ORG_ID]) expect(other).not.toBe(SUSPENDABLE_PLATFORM_ORG_ID);
  });
});

describe('renderingsOf names both forms of one id (the mirror-injection helpers write/remove both)', () => {
  it('is [TypeID, bare UUID] whichever form it is given, and the single rendering of a non-user principal', () => {
    const typeId = testUser('both');
    const uuid = canonicalUuid(typeId);
    expect(renderingsOf(typeId, 'user')).toEqual([typeId, uuid]);
    expect(renderingsOf(uuid, 'user')).toEqual([typeId, uuid]);
    expect(renderingsOf(uuid.toUpperCase(), 'user')).toEqual([typeId, uuid]);
    const org = testOrg('both');
    expect(renderingsOf(canonicalUuid(org), 'organization')).toEqual([org, canonicalUuid(org)]);
    expect(renderingsOf('svc:selection-list-service-ci', 'user')).toEqual(['svc:selection-list-service-ci']);
  });
});

describe('FAKE_SECURITY_URL: fixtures go to the Security API the service under test uses', () => {
  // helpers/security-url.ts resolves once at import, so each case imports a fresh copy under its own env.
  const resolve = (env: Record<string, string | undefined>): string => {
    const saved = { f: process.env['FAKE_SECURITY_URL'], s: process.env['SECURITY_SERVICE_URL'] };
    try {
      for (const k of ['FAKE_SECURITY_URL', 'SECURITY_SERVICE_URL']) {
        if (env[k] === undefined) delete process.env[k];
        else process.env[k] = env[k];
      }
      let url = '';
      jest.isolateModules(() => {
        url = (require('../helpers/security-url') as typeof import('../helpers/security-url')).FAKE_SECURITY_URL;
      });
      return url;
    } finally {
      for (const [k, v] of [['FAKE_SECURITY_URL', saved.f], ['SECURITY_SERVICE_URL', saved.s]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  it('defaults to SECURITY_SERVICE_URL (what the service is pointed at), not a hard-coded port', () => {
    expect(resolve({ SECURITY_SERVICE_URL: 'http://localhost:4999' })).toBe('http://localhost:4999');
  });
  it('FAKE_SECURITY_URL overrides it only when explicitly set', () => {
    expect(resolve({ FAKE_SECURITY_URL: 'http://stand-in:3002', SECURITY_SERVICE_URL: 'http://localhost:4999' })).toBe('http://stand-in:3002');
    expect(resolve({ FAKE_SECURITY_URL: '', SECURITY_SERVICE_URL: 'http://localhost:4999' })).toBe('http://localhost:4999');
  });
  it('falls back to the stand-in default port with neither set, and drops trailing slashes', () => {
    expect(resolve({})).toBe('http://localhost:3002');
    expect(resolve({ SECURITY_SERVICE_URL: 'http://localhost:4999//' })).toBe('http://localhost:4999');
  });
});

describe('the stand-in Security API answers identically for a TypeID and its bare UUID', () => {
  const check = async (body: unknown): Promise<boolean> => {
    const res = await fetch(`${FAKE_SECURITY_URL}/api/v1/security/authz/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${fakeUserToken()}` },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { allow: boolean }).allow;
  };
  // the stand-in decodes (does not verify) the JWT; any well-formed token will do for a decision query
  const fakeUserToken = (): string =>
    `x.${Buffer.from(JSON.stringify({ userId: 'nobody', orgId: 'nowhere' })).toString('base64url')}.y`;

  it('an instance grant made under the TypeIDs is found by a check under the UUIDs, and the reverse', async () => {
    const [org, user] = [newOrg('canon'), newUser('canon')];
    const [orgUuid, userUuid] = [canonicalUuid(org), canonicalUuid(user)];
    const [orgB, userB] = [newOrg('canonb'), newUser('canonb')];
    const [orgBUuid, userBUuid] = [canonicalUuid(orgB), canonicalUuid(userB)];
    const key = `list-${Math.random().toString(16).slice(2)}`;
    const resource = { type: 'SelectionList', key };
    const grant = (tenant: string, subject: string) =>
      fetch(`${FAKE_SECURITY_URL}/__fixture/grants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, subject, role: 'list-owner', resource }),
      });

    expect((await grant(org, user)).status).toBe(201); // granted by TypeID
    expect((await grant(orgBUuid, userBUuid)).status).toBe(201); // granted by UUID

    for (const [tenant, subject] of [[org, user], [orgUuid, userUuid], [org, userUuid], [orgUuid, user]]) {
      expect(await check({ subject, tenant, resource, action: 'manage_access' })).toBe(true);
    }
    for (const [tenant, subject] of [[orgB, userB], [orgBUuid, userBUuid]]) {
      expect(await check({ subject, tenant, resource, action: 'manage_access' })).toBe(true);
    }
    // a different user in the same tenant, and the same user in a different tenant, hold nothing
    expect(await check({ subject: userB, tenant: org, resource, action: 'manage_access' })).toBe(false);
    expect(await check({ subject: user, tenant: orgB, resource, action: 'manage_access' })).toBe(false);
  });
});
