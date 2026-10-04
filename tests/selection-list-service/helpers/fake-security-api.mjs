#!/usr/bin/env node
/**
 * In-memory stand-in for FuzeFront's Security API authz surface
 * (`/api/v1/security/authz/{check,bulk-check,grants}`), used ONLY by the
 * selection-list-service integration/acceptance suite in CI.
 *
 * WHY THIS EXISTS
 *   The service holds no authorization state of its own — every decision is a
 *   call to the Security API (middleware/authz.ts), and `selection_list_access`
 *   is only a read-model mirror. Without *an* authorization backend the
 *   role-matrix tests (security/authz.test.ts) and the mirror-not-authority
 *   regression tests cannot pass by construction: a service whose authz client
 *   is stubbed allow-all (the NODE_ENV=test no-op) grants everything to
 *   everyone. The README prerequisite "use a Permit mock/test environment"
 *   means exactly this. This process IS that environment — it is NOT part of
 *   the product and is never deployed.
 *
 * WHAT IT MODELS (and nothing more)
 *   - Instance-scoped role grants: POST/DELETE/GET /authz/grants. Roles stack
 *     at this layer (like Permit); it is the SERVICE's job to revoke the old
 *     role when it changes one (openapi: "roles do not stack").
 *   - Decisions: POST /authz/check and /authz/bulk-check, using the role ->
 *     action matrix frozen in services/selection-list-service/openapi.yaml
 *     (§Authorization). `org-admin` in the caller's JWT `roles` claim derives
 *     list-owner on every list in the caller's tenant (no explicit grant).
 *   - Tenant membership: `Organization:read` is answered from the declared
 *     NON_MEMBERS fixture below — everyone else is a member of the tenant
 *     they are asked about. This is the one place the suite's declared
 *     "outsider" (contract/access.test.ts USER_OUTSIDER, "NOT in ORG_ID") is
 *     encoded, deliberately explicit rather than guessed from id shapes.
 *
 * The caller's bearer token is decoded WITHOUT verification: the service has
 * already verified it, and this process only runs on localhost in CI.
 *
 * Usage:  node tests/selection-list-service/helpers/fake-security-api.mjs
 *         PORT (default 3002)
 */
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3002);

/** `${tenant}|${userId}` pairs that are NOT members of that tenant. */
const NON_MEMBERS = new Set([
  'org_01test00000000access000000|usr_01test00000000accessout000',
]);

/** role -> actions, verbatim from the openapi §Authorization table. */
const ROLE_ACTIONS = {
  'list-owner': ['read', 'add_value', 'update_value', 'remove_value', 'translate', 'update', 'delete', 'manage_access'],
  'list-editor': ['read', 'add_value', 'update_value', 'remove_value', 'translate', 'update'],
  'list-contributor': ['read', 'add_value', 'update_value', 'translate'],
  'list-translator': ['read', 'translate'],
  'list-viewer': ['read'],
};

/** `${tenant}|${type}:${key}|${subject}` -> Set<role> */
const grants = new Map();
let grantSeq = 0;

function grantKey(tenant, resource, subject) {
  return `${tenant}|${resource?.type ?? ''}:${resource?.key ?? ''}|${subject}`;
}

function claimsOf(req) {
  const h = req.headers['authorization'];
  if (!h) return null;
  const [scheme, token] = String(h).split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function isMember(tenant, subject) {
  return !NON_MEMBERS.has(`${tenant}|${subject}`);
}

function decide(q, claims) {
  const { subject, tenant, resource, action } = q;
  if (!subject || !tenant || !resource?.type || !action) return false;

  if (resource.type === 'Organization') {
    return action === 'read' && isMember(tenant, subject);
  }
  if (resource.type !== 'SelectionList') return false;
  if (!isMember(tenant, subject)) return false;

  // org-admin derives list-owner on every list in the tenant.
  const isOrgAdmin =
    claims && claims.sub === subject && claims.organization_id === tenant &&
    Array.isArray(claims.roles) && claims.roles.includes('org-admin');
  if (isOrgAdmin) return ROLE_ACTIONS['list-owner'].includes(action);

  if (!resource.key) {
    // Tenant-level operations (create a list, list lists, quota): any member.
    return ['read', 'add_value'].includes(action);
  }
  const roles = grants.get(grantKey(tenant, resource, subject)) ?? new Set();
  for (const role of roles) {
    if ((ROLE_ACTIONS[role] ?? []).includes(action)) return true;
  }
  return false;
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

function send(res, status, body) {
  if (status === 204) {
    res.writeHead(204).end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (path === '/health') return send(res, 200, { status: 'ok', service: 'fake-security-api' });

  const claims = claimsOf(req);
  if (!claims) return send(res, 401, { error: 'Authentication required', code: 'AUTH_REQUIRED' });

  if (req.method === 'POST' && path === '/api/v1/security/authz/check') {
    const body = await readBody(req);
    if (!body) return send(res, 400, { error: 'Malformed query', code: 'MALFORMED' });
    return send(res, 200, { allow: decide({ ...body, subject: body.subject || claims.sub }, claims) });
  }

  if (req.method === 'POST' && path === '/api/v1/security/authz/bulk-check') {
    const body = await readBody(req);
    if (!body || !Array.isArray(body.checks) || body.checks.length < 1 || body.checks.length > 200) {
      return send(res, 400, { error: 'Malformed checks', code: 'MALFORMED' });
    }
    return send(res, 200, {
      decisions: body.checks.map((c) => ({ allow: decide({ ...c, subject: c.subject || claims.sub }, claims) })),
    });
  }

  if (path === '/api/v1/security/authz/grants') {
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (!b || !b.subject || !b.tenant || !b.role) {
        return send(res, 400, { error: 'subject, tenant and role are required', code: 'MALFORMED' });
      }
      if (!ROLE_ACTIONS[b.role]) return send(res, 400, { error: `unknown role ${b.role}`, code: 'MALFORMED' });
      const k = grantKey(b.tenant, b.resource, b.subject);
      const roles = grants.get(k) ?? new Set();
      roles.add(b.role);
      grants.set(k, roles);
      return send(res, 201, {
        id: `grant_${++grantSeq}`,
        subject: b.subject,
        tenant: b.tenant,
        role: b.role,
        resource: b.resource,
        createdAt: Date.now(),
      });
    }
    if (req.method === 'DELETE') {
      const b = await readBody(req);
      if (!b || !(b.subject && b.tenant && b.role)) {
        return send(res, 400, { error: 'subject+tenant+role required', code: 'MALFORMED' });
      }
      const k = grantKey(b.tenant, b.resource, b.subject);
      const roles = grants.get(k);
      if (roles) {
        roles.delete(b.role);
        if (roles.size === 0) grants.delete(k);
      }
      return send(res, 204);
    }
    if (req.method === 'GET') {
      return send(res, 200, { items: [], page: { nextCursor: null, hasMore: false } });
    }
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  process.stdout.write(`[fake-security-api] listening on ${PORT}\n`);
});
