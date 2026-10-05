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
 *   - Decisions: POST /authz/check and /authz/bulk-check, using the SAME
 *     two-level matrix the Permit schema declares (review H-3), never a
 *     shortcut a real policy does not contain. Verbatim from
 *     docs/planning/selection-lists-permit-actions.md (contract 3.0.0):
 *       * resource `SelectionList` (instance-scoped, key = list id): only the
 *         per-list roles list-owner|editor|contributor|translator|viewer, and
 *         only per-list actions (read, add_value, ... manage_access).
 *       * resource `SelectionListCatalog` (tenant-level, keyless): the TENANT
 *         roles carry ONLY the catalog actions
 *           admin     list create read_quota resolve
 *           editor    list create            resolve
 *           viewer    list                   resolve
 *           developer (none)
 *         The caller's tenant role is read from the JWT `roles` claim (the most
 *         privileged of admin|editor|viewer|developer; `org-admin` is an alias
 *         of admin). A token carrying NONE of those is treated as a tenant
 *         `admin` — a fixture convenience so the many plain-token tests can
 *         create lists and read quota; it grants NO per-list action.
 *     A tenant role is NEVER evaluated for a per-list action: every tenant role
 *     — admin included — is denied `SelectionList:*` on a list it holds no
 *     per-list role on, and a keyless `SelectionList` check is always denied.
 *     There is NO org-admin -> list-owner derivation (contract 3.0.0 §5). The
 *     old stand-in allowed keyless `read`/`add_value` to any member and derived
 *     list-owner for org-admin: two rules no real policy contains, which hid
 *     review H-3.
 *   - Tenant membership: `Organization:read` is answered from the declared
 *     NON_MEMBERS fixture below — everyone else is a member of the tenant
 *     they are asked about. This is the one place the suite's declared
 *     "outsider" (contract/access.test.ts USER_OUTSIDER, "NOT in ORG_ID") is
 *     encoded, deliberately explicit rather than guessed from id shapes.
 *
 * MACHINE IDENTITY (review C-1). The real Security API is being fixed so that a
 * non-admin HUMAN session is denied grant/revoke; only a machine caller whose
 * token carries the `authz:admin` scope may write grants
 * (backend/security/src/routes/authz.ts AUTHZ_ADMIN_SCOPE). The stand-in models
 * that: POST /api/v1/security/tokens issues a machine token for the one CI
 * client below, and POST/DELETE /authz/grants answer 403 to anything else —
 * including any user JWT. That makes this suite fail if the service ever goes
 * back to writing grants with the END USER's token.
 *
 * The caller's bearer token is decoded WITHOUT verification: the service has
 * already verified it, and this process only runs on localhost in CI.
 *
 * Usage:  node tests/selection-list-service/helpers/fake-security-api.mjs
 *         PORT (default 3002)
 */
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3002);

/** The one OAuth client this stand-in knows (CI-only fixture values, not real credentials). */
const MACHINE_CLIENT_ID = process.env.FAKE_SEC_CLIENT_ID ?? 'selection-list-service-ci';
const MACHINE_CLIENT_SECRET = process.env.FAKE_SEC_CLIENT_SECRET ?? 'ci-only-fixture-client-secret';
const AUTHZ_ADMIN_SCOPE = 'authz:admin';
const MACHINE_TOKEN_PREFIX = 'fake-machine-token:';

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

/**
 * Tenant roles -> actions on the keyless SelectionListCatalog resource ONLY
 * (review H-3). No tenant role carries any per-list (`SelectionList`) action.
 */
const TENANT_ROLE_ACTIONS = {
  admin: ['list', 'create', 'read_quota', 'resolve'],
  editor: ['list', 'create', 'resolve'],
  viewer: ['list', 'resolve'],
  developer: [],
};
/** most privileged first */
const TENANT_ROLE_ORDER = ['admin', 'editor', 'viewer', 'developer'];

/** `${tenant}|${type}:${key}|${subject}` -> Set<role> */
const grants = new Map();
let grantSeq = 0;

function grantKey(tenant, resource, subject) {
  return `${tenant}|${resource?.type ?? ''}:${resource?.key ?? ''}|${subject}`;
}

/** Scopes of a machine token minted by THIS process, else null (humans / garbage). */
function machineScopesOf(req) {
  const h = req.headers['authorization'];
  if (!h) return null;
  const [scheme, token] = String(h).split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || !token.startsWith(MACHINE_TOKEN_PREFIX)) return null;
  return token.slice(MACHINE_TOKEN_PREFIX.length).split('+').filter(Boolean);
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

/** The caller's tenant role, from the JWT `roles` claim (see header). */
function tenantRoleOf(claims, subject, tenant) {
  if (!(claims && claims.sub === subject && claims.organization_id === tenant)) return 'developer'; // unknowable -> least
  const roles = Array.isArray(claims.roles) ? claims.roles.map((r) => (r === 'org-admin' ? 'admin' : r)) : [];
  return TENANT_ROLE_ORDER.find((r) => roles.includes(r)) ?? 'admin';
}

function decide(q, claims) {
  const { subject, tenant, resource, action } = q;
  if (!subject || !tenant || !resource?.type || !action) return false;

  if (resource.type === 'Organization') {
    return action === 'read' && isMember(tenant, subject);
  }
  if (!isMember(tenant, subject)) return false;

  // Tenant level: keyless catalog resource, tenant roles, catalog actions only.
  if (resource.type === 'SelectionListCatalog') {
    if (resource.key) return false; // the catalog has no instances
    return TENANT_ROLE_ACTIONS[tenantRoleOf(claims, subject, tenant)].includes(action);
  }

  // Instance level: per-list roles, per-list actions only.
  if (resource.type !== 'SelectionList') return false;
  // There is no tenant-wide per-list grant: a keyless SelectionList check is
  // never allowed, whoever asks.
  if (!resource.key) return false;

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

  // POST /tokens — client_credentials issuance (no bearer; the credentials ARE the auth).
  if (req.method === 'POST' && path === '/api/v1/security/tokens') {
    const b = await readBody(req);
    if (!b || b.clientId !== MACHINE_CLIENT_ID || b.clientSecret !== MACHINE_CLIENT_SECRET) {
      return send(res, 401, { error: 'invalid client credentials', code: 'AUTH_REQUIRED' });
    }
    const scope = String(b.scope ?? '').split(' ').filter(Boolean);
    return send(res, 200, {
      accessToken: `${MACHINE_TOKEN_PREFIX}${scope.join('+')}`,
      tokenType: 'Bearer',
      expiresIn: 300,
      scope: scope.join(' '),
    });
  }

  // Grant/revoke WRITES: machine callers holding authz:admin only. A human
  // session — even a valid one — is denied (what the fixed Security API does).
  if (path === '/api/v1/security/authz/grants' && (req.method === 'POST' || req.method === 'DELETE')) {
    const scopes = machineScopesOf(req);
    if (!scopes) return send(res, 403, { error: 'grant/revoke require a machine caller with the authz:admin scope', code: 'FORBIDDEN' });
    if (!scopes.includes(AUTHZ_ADMIN_SCOPE)) {
      return send(res, 403, { error: `machine caller is missing the required '${AUTHZ_ADMIN_SCOPE}' scope`, code: 'FORBIDDEN' });
    }
  }

  // Everything below authenticates a HUMAN session token (decoded, not verified).
  // GET /authz/grants (listing) and decisions keep using it; the machine-only
  // write routes above were already authorised, so give them a synthetic caller.
  // A machine token (the service's own identity, minted by POST /tokens above) is a valid caller for
  // every authz route, like the real Security API's caller(): it is how the service asks decision
  // questions about OTHER subjects when no end-user token exists (e.g. the identity.user.deleted
  // handler's last-owner probe). It carries no tenant role, so it can never satisfy a tenant-level check.
  const claims = machineScopesOf(req) ? { sub: `svc:${MACHINE_CLIENT_ID}` } : claimsOf(req);
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
      // A per-list role only exists on a SelectionList INSTANCE (resource role in
      // the Permit schema): granting it tenant-wide / keyless is rejected, so a
      // regression that drops `resource` fails loudly instead of widening access.
      if (b.resource?.type !== 'SelectionList' || !b.resource?.key) {
        return send(res, 400, { error: `role ${b.role} is an instance role: resource {type:'SelectionList', key} required`, code: 'MALFORMED' });
      }
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
      // The caller's (or, with ?subject=, another subject's) grants in a tenant, instance-scoped ones
      // carrying their `resource`, like the real GET /authz/grants. Single page.
      const tenant = url.searchParams.get('tenant');
      if (!tenant) return send(res, 400, { error: 'tenant is required', code: 'MALFORMED' });
      const subject = url.searchParams.get('subject') || claims.sub;
      const items = [];
      for (const [k, roles] of grants) {
        const [t, res_, s] = k.split('|');
        if (t !== tenant || s !== subject) continue;
        const idx = res_.indexOf(':');
        for (const role of roles) {
          items.push({
            id: `${t}:${s}:${role}`,
            subject: s,
            tenant: t,
            role,
            resource: { type: res_.slice(0, idx), key: res_.slice(idx + 1) },
          });
        }
      }
      return send(res, 200, { items, page: { nextCursor: null, hasMore: false, total: items.length } });
    }
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  process.stdout.write(`[fake-security-api] listening on ${PORT}\n`);
});
