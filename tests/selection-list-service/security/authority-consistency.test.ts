/**
 * Security tests — the Security API is the AUTHORITY; the mirror only nominates candidates (review M-2, L-5)
 *
 * M-2: the last-owner 409 used to count `selection_list_access` rows. When the mirror and the Security
 * API disagree (a failed role change, a deleted user, a direct revoke by an operator) that count is
 * inflated, and the REAL last owner could be demoted, leaving a list nobody can administer. The guard now
 * requires another owner CONFIRMED by the Security API (`manage_access` on the instance).
 *
 * L-5: purging a list revokes the instance's grants in the Security API (they were left as orphan role
 * assignments).
 *
 * Both are observed end to end: the service under test talks to the stand-in Security API
 * (helpers/fake-security-api.mjs); this suite reaches the SAME stand-in through its operator fixture
 * surface (`/__fixture/*`: the service's own workload identity cannot grant or revoke arbitrary
 * assignments, by design) to create the divergence an operator or a half-failed change would, and
 * reads the grants back.
 *
 * Credentials observed: a human's role change / purge is revoked with THAT human's token; the purge
 * fallback for a departed grantee, and `identity.user.deleted`, use the narrow cleanup workload scope.
 */

import { rawFetch } from '../helpers/client';
import { mintTestToken } from '../helpers/auth';
import { testOrg, testUser } from '../helpers/ids';
import { FAKE_SECURITY_URL } from '../helpers/security-url';

const FAKE_URL = FAKE_SECURITY_URL;

const ORG_ID = testOrg('authorit');
const OWNER = testUser('authora');
const PEER = testUser('authorb');
const tokenFor = (userId: string) => () => mintTestToken({ userId, organizationId: ORG_ID });

type Resp = { status: number; body: any };
const api = (userId: string, method: string, path: string, body?: unknown): Promise<Resp> =>
  rawFetch(path, { method, token: tokenFor(userId)(), body: body === undefined ? undefined : JSON.stringify(body) }) as Promise<Resp>;

/** Operator action on the stand-in, behind the service's back. */
async function direct(method: 'POST' | 'DELETE', subject: string, role: string, listId: string): Promise<number> {
  const res = await fetch(`${FAKE_URL}/__fixture/grants`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject, tenant: ORG_ID, role, resource: { type: 'SelectionList', key: listId } }),
  });
  return res.status;
}

/** Mark a principal gone in the stand-in (deactivated user, or a member who left the tenant). */
async function markGone(subject: string, kind: 'deactivated' | 'departed'): Promise<void> {
  const res = await fetch(`${FAKE_URL}/__fixture/gone`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenant: ORG_ID, subject, kind }),
  });
  expect(res.status).toBe(204);
}

async function grantsOf(userId: string): Promise<Array<{ role: string; resource?: { type: string; key: string } }>> {
  const res = await fetch(`${FAKE_URL}/api/v1/security/authz/grants?tenant=${ORG_ID}&subject=${encodeURIComponent(userId)}`, {
    headers: { authorization: `Bearer ${tokenFor(userId)()}` },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: Array<{ role: string; resource?: { type: string; key: string } }> }).items;
}

const newList = async (tag: string): Promise<string> => {
  const r = await api(OWNER, 'POST', '/v1/selection-lists', { key: `auth-${tag}-${Math.random().toString(16).slice(2, 8)}`, name: tag });
  expect(r.status).toBe(201);
  return r.body.id;
};

describe('M-2: the last-owner guard is decided by the Security API, not by counting mirror rows', () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const id of created) await api(OWNER, 'DELETE', `/v1/selection-lists/${id}?purge=true`);
  });

  it('a second mirror owner whose grant was revoked behind the service\'s back does NOT make the real owner demotable (409)', async () => {
    const id = await newList('drift-demote');
    created.push(id);
    expect((await api(OWNER, 'PUT', `/v1/selection-lists/${id}/access/${PEER}`, { role: 'list-owner' })).status).toBe(200);

    // an operator removes PEER's owner grant directly in the Security API: the mirror still says "owner"
    expect(await direct('DELETE', PEER, 'list-owner', id)).toBe(204);

    const demote = await api(OWNER, 'PUT', `/v1/selection-lists/${id}/access/${OWNER}`, { role: 'list-editor' });
    expect(demote.status).toBe(409);
    expect(demote.body.code).toBe('CONFLICT');

    const remove = await api(OWNER, 'DELETE', `/v1/selection-lists/${id}/access/${OWNER}`);
    expect(remove.status).toBe(409);

    // the real owner is untouched in the authority
    const roles = (await grantsOf(OWNER)).filter((g) => g.resource?.key === id).map((g) => g.role);
    expect(roles).toEqual(['list-owner']);
  });

  it('once the second owner is real again the demotion is allowed (the guard is not just always-409)', async () => {
    const id = await newList('drift-recover');
    created.push(id);
    expect((await api(OWNER, 'PUT', `/v1/selection-lists/${id}/access/${PEER}`, { role: 'list-owner' })).status).toBe(200);
    expect(await direct('DELETE', PEER, 'list-owner', id)).toBe(204);
    expect((await api(OWNER, 'PUT', `/v1/selection-lists/${id}/access/${OWNER}`, { role: 'list-editor' })).status).toBe(409);

    expect(await direct('POST', PEER, 'list-owner', id)).toBe(201); // re-granted in the authority

    const demote = await api(OWNER, 'PUT', `/v1/selection-lists/${id}/access/${OWNER}`, { role: 'list-editor' });
    expect(demote.status).toBe(200);
    expect(demote.body.role).toBe('list-editor');
    // and the authority now has OWNER as an editor only (roles do not stack)
    const roles = (await grantsOf(OWNER)).filter((g) => g.resource?.key === id).map((g) => g.role);
    expect(roles).toEqual(['list-editor']);
  });

  it('with two confirmed owners the ordinary demote / revoke still work', async () => {
    const id = await newList('two-owners');
    created.push(id);
    expect((await api(OWNER, 'PUT', `/v1/selection-lists/${id}/access/${PEER}`, { role: 'list-owner' })).status).toBe(200);
    expect((await api(OWNER, 'PUT', `/v1/selection-lists/${id}/access/${OWNER}`, { role: 'list-viewer' })).status).toBe(200);
    // PEER is now the sole owner: they cannot be removed
    expect((await api(PEER, 'DELETE', `/v1/selection-lists/${id}/access/${PEER}`)).status).toBe(409);
  });
});

describe('L-5: purging a list revokes its grants in the Security API', () => {
  it('no SelectionList:<id> assignment survives a purge (every role that was live on it)', async () => {
    const id = await newList('purge-grants');
    expect((await api(OWNER, 'PUT', `/v1/selection-lists/${id}/access/${PEER}`, { role: 'list-editor' })).status).toBe(200);
    expect((await grantsOf(OWNER)).some((g) => g.resource?.key === id)).toBe(true);
    expect((await grantsOf(PEER)).some((g) => g.resource?.key === id)).toBe(true);

    const purged = await api(OWNER, 'DELETE', `/v1/selection-lists/${id}?purge=true`);
    expect(purged.status).toBe(204);

    expect((await grantsOf(OWNER)).some((g) => g.resource?.key === id)).toBe(false);
    expect((await grantsOf(PEER)).some((g) => g.resource?.key === id)).toBe(false);
  });

  it('a grantee who has left the tenant (the human gate refuses them) is still cleaned up, via the narrow cleanup scope', async () => {
    const id = await newList('purge-departed');
    const LEAVER = testUser('authorc');
    expect((await api(OWNER, 'PUT', `/v1/selection-lists/${id}/access/${LEAVER}`, { role: 'list-editor' })).status).toBe(200);
    expect((await grantsOf(LEAVER)).some((g) => g.resource?.key === id)).toBe(true);

    await markGone(LEAVER, 'departed');
    expect((await api(OWNER, 'DELETE', `/v1/selection-lists/${id}?purge=true`)).status).toBe(204);

    expect((await grantsOf(LEAVER)).some((g) => g.resource?.key === id)).toBe(false);
    expect((await grantsOf(OWNER)).some((g) => g.resource?.key === id)).toBe(false);
  });

  it('archiving does NOT revoke: the owner keeps their grant on an archived list', async () => {
    const id = await newList('archive-keeps');
    expect((await api(OWNER, 'POST', `/v1/selection-lists/${id}/archive`)).status).toBe(200);
    expect((await grantsOf(OWNER)).some((g) => g.resource?.key === id)).toBe(true);
    await api(OWNER, 'DELETE', `/v1/selection-lists/${id}?purge=true`);
  });
});
