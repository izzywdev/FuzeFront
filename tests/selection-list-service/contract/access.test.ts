/**
 * Contract tests — GET/PUT/DELETE /v1/selection-lists/{listId}/access
 *
 * Verifies:
 *   - Grant/update/revoke: PUT idempotent, DELETE idempotent
 *   - Last-owner protection: demoting or revoking the last list-owner → 409
 *   - Roles do not stack: PUT replaces, not appends
 *   - Pagination of access grants
 *   - User must be in the org to be granted access (400 if not)
 *   - Grant shape: list_id, user_id, role, granted_by, granted_at, updated_at
 *
 * Tests are ALL RED until the service is implemented.
 */

import { makeClient, rawFetch } from '../helpers/client';
import { mintTestToken } from '../helpers/auth';
import { createTestList, purgeList } from '../helpers/factories';
import type { SelectionListId } from '../helpers/factories';

// ---------------------------------------------------------------------------
// Test actors — two users in the same org
// ---------------------------------------------------------------------------

const ORG_ID = 'org_01test00000000access000000';
const USER_OWNER = 'usr_01test00000000accessowner0';
const USER_EDITOR = 'usr_01test00000000accessedit00';
const USER_OUTSIDER = 'usr_01test00000000accessout000'; // NOT in ORG_ID

function ownerToken(): string {
  return mintTestToken({ userId: USER_OWNER, organizationId: ORG_ID });
}

function editorToken(): string {
  return mintTestToken({ userId: USER_EDITOR, organizationId: ORG_ID });
}

const createdListIds: SelectionListId[] = [];

afterAll(async () => {
  const client = makeClient(ownerToken);
  for (const id of createdListIds) {
    await purgeList(client, id);
  }
});

// ---------------------------------------------------------------------------
// Grant shape
// ---------------------------------------------------------------------------

describe('PUT /v1/selection-lists/{listId}/access/{userId} — response shape', () => {
  it('grant returns the correct AccessGrant shape', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'access-shape-' + Math.random().toString(16).slice(2, 8),
      name: 'Access Shape Test',
    });
    createdListIds.push(list.id as SelectionListId);

    const grant = await client.setAccess(
      list.id as SelectionListId,
      USER_EDITOR,
      'list-editor'
    );

    expect(grant.list_id).toBe(list.id);
    expect(grant.user_id).toBe(USER_EDITOR);
    expect(grant.role).toBe('list-editor');
    expect(typeof grant.granted_by).toBe('string');
    expect(new Date(grant.granted_at).getTime()).not.toBeNaN();
    expect(new Date(grant.updated_at).getTime()).not.toBeNaN();
  });

  it('PUT is idempotent: setting the same role twice returns 200 both times', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'access-idemp-' + Math.random().toString(16).slice(2, 8),
      name: 'Idempotent Grant',
    });
    createdListIds.push(list.id as SelectionListId);

    await client.setAccess(list.id as SelectionListId, USER_EDITOR, 'list-editor');
    const second = await client.setAccess(list.id as SelectionListId, USER_EDITOR, 'list-editor');
    expect(second.role).toBe('list-editor');
  });

  it('roles do not stack: PUT replaces the existing role', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'access-stack-' + Math.random().toString(16).slice(2, 8),
      name: 'Role Stack Test',
    });
    createdListIds.push(list.id as SelectionListId);

    await client.setAccess(list.id as SelectionListId, USER_EDITOR, 'list-viewer');
    const updated = await client.setAccess(list.id as SelectionListId, USER_EDITOR, 'list-editor');
    expect(updated.role).toBe('list-editor');

    // Verify through the access list: only one grant exists for this user
    const page = await client.getAccess(list.id as SelectionListId);
    const grantsForEditor = page.items.filter((g) => g.user_id === USER_EDITOR);
    expect(grantsForEditor.length).toBe(1);
    expect(grantsForEditor[0].role).toBe('list-editor');
  });
});

// ---------------------------------------------------------------------------
// Last-owner protection (FFRNT-242 adjacency)
// ---------------------------------------------------------------------------

describe('Last-owner protection', () => {
  it('demoting the only list-owner to a lower role returns 409 CONFLICT', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'last-owner-dem-' + Math.random().toString(16).slice(2, 8),
      name: 'Last Owner Demotion',
    });
    createdListIds.push(list.id as SelectionListId);
    // USER_OWNER is the only list-owner (auto-granted on create)

    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/access/${encodeURIComponent(USER_OWNER)}`,
      {
        method: 'PUT',
        token: ownerToken(),
        body: JSON.stringify({ role: 'list-editor' }),
      }
    );
    expect(status).toBe(409);
    expect((body as { code?: string }).code).toBe('CONFLICT');
  });

  it('revoking the only list-owner returns 409 CONFLICT', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'last-owner-rev-' + Math.random().toString(16).slice(2, 8),
      name: 'Last Owner Revoke',
    });
    createdListIds.push(list.id as SelectionListId);

    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/access/${encodeURIComponent(USER_OWNER)}`,
      {
        method: 'DELETE',
        token: ownerToken(),
      }
    );
    expect(status).toBe(409);
    expect((body as { code?: string }).code).toBe('CONFLICT');
  });

  it('can demote the owner when a second owner exists', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'two-owner-' + Math.random().toString(16).slice(2, 8),
      name: 'Two Owners',
    });
    createdListIds.push(list.id as SelectionListId);

    // Add USER_EDITOR as a second owner
    await client.setAccess(list.id as SelectionListId, USER_EDITOR, 'list-owner');

    // Now demote USER_OWNER — should succeed because USER_EDITOR is still owner
    const grant = await client.setAccess(list.id as SelectionListId, USER_OWNER, 'list-editor');
    expect(grant.role).toBe('list-editor');
  });
});

// ---------------------------------------------------------------------------
// Delete / revoke
// ---------------------------------------------------------------------------

describe('DELETE /v1/selection-lists/{listId}/access/{userId}', () => {
  it('revoke returns 204 and the grant is gone', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'revoke-' + Math.random().toString(16).slice(2, 8),
      name: 'Revoke Test',
    });
    createdListIds.push(list.id as SelectionListId);

    // Add editor, then add a second owner so we can revoke the editor freely
    await client.setAccess(list.id as SelectionListId, USER_EDITOR, 'list-editor');
    await client.revokeAccess(list.id as SelectionListId, USER_EDITOR);

    const page = await client.getAccess(list.id as SelectionListId);
    expect(page.items.map((g) => g.user_id)).not.toContain(USER_EDITOR);
  });

  it('revoking a grant that does not exist returns 204 (idempotent)', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'revoke-idemp-' + Math.random().toString(16).slice(2, 8),
      name: 'Revoke Idempotent',
    });
    createdListIds.push(list.id as SelectionListId);

    // USER_EDITOR was never granted — still should be 204
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/access/${encodeURIComponent(USER_EDITOR)}`,
      { method: 'DELETE', token: ownerToken() }
    );
    expect(status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// Pagination of access grants
// ---------------------------------------------------------------------------

describe('GET /v1/selection-lists/{listId}/access — pagination', () => {
  it('returns the pagination envelope with items + page', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'access-pag-' + Math.random().toString(16).slice(2, 8),
      name: 'Access Pagination',
    });
    createdListIds.push(list.id as SelectionListId);

    const page = await client.getAccess(list.id as SelectionListId);
    expect(page).toHaveProperty('items');
    expect(page).toHaveProperty('page');
    expect(page.page).toHaveProperty('nextCursor');
    expect(page.page).toHaveProperty('hasMore');
    expect(Array.isArray(page.items)).toBe(true);
    // The creator is automatically a list-owner
    expect(page.items.length).toBeGreaterThanOrEqual(1);
  });

  it('limit is clamped to 200', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'access-clamp-' + Math.random().toString(16).slice(2, 8),
      name: 'Access Clamp',
    });
    createdListIds.push(list.id as SelectionListId);

    const page = await client.getAccess(list.id as SelectionListId, { limit: 9999 });
    expect(page.items.length).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// User must be in org
// ---------------------------------------------------------------------------

describe('PUT /v1/selection-lists/{listId}/access/{userId} — org membership', () => {
  it('granting access to a user outside the org returns 400 VALIDATION_ERROR', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'access-out-' + Math.random().toString(16).slice(2, 8),
      name: 'Outsider Grant',
    });
    createdListIds.push(list.id as SelectionListId);

    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/access/${encodeURIComponent(USER_OUTSIDER)}`,
      {
        method: 'PUT',
        token: ownerToken(),
        body: JSON.stringify({ role: 'list-viewer' }),
      }
    );
    // User is not in the org — spec says 400 VALIDATION_ERROR
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Access to the access endpoint itself
// ---------------------------------------------------------------------------

describe('GET /v1/selection-lists/{listId}/access — authorization', () => {
  it('a list-editor cannot read the access grants (requires manage_access)', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'access-rbac-' + Math.random().toString(16).slice(2, 8),
      name: 'Access RBAC',
    });
    createdListIds.push(list.id as SelectionListId);

    // Grant USER_EDITOR the list-editor role
    await client.setAccess(list.id as SelectionListId, USER_EDITOR, 'list-editor');

    // Now USER_EDITOR should be refused manage_access
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/access`,
      { method: 'GET', token: editorToken() }
    );
    expect(status).toBe(403);
  });
});
