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
 *   - Contract 4.1.0 catalog actions (docs/planning/selection-lists-shared-and-fork.md D3/D5;
 *     backend/src/permit/schema.ts is the source of truth):
 *       * `read_shared`      admin | editor | viewer  (NOT developer). Evaluated in the tenant the
 *                            caller asks about, from the caller's tenant role like every catalog
 *                            action. Confers NO `SelectionList:*` action.
 *       * `publish_platform` admin only, and EFFECTIVE ONLY IN THE PLATFORM ORGANIZATION'S TENANT.
 *                            The platform org id is declared with `POST /__fixture/platform-org`
 *                            {orgId} (or env FAKE_PLATFORM_ORG_ID at start-up). Until one is
 *                            declared the action is effective nowhere (fail closed, like the
 *                            service itself). A caller's tenant role is the one in the org its
 *                            token acts in, so a customer-org admin asking about the platform
 *                            tenant is not an admin there and is denied.
 *                            `POST /__fixture/publish-anywhere` {tenant} switches ONE tenant to bare
 *                            Permit behaviour (the schema grants tenant `admin` the action in the
 *                            admin's own tenant), so a suite can prove the SERVICE ITSELF refuses a
 *                            publish by an admin acting outside the platform org (D5) instead of
 *                            relying on this stand-in having already denied it. Per-tenant, so
 *                            suites running in parallel workers never see each other's setting.
 *
 *   - `POST /__fixture/deny-catalog-action` {tenant, subject, action} withdraws ONE catalog action (e.g.
 *     `read_shared`) from ONE subject in ONE tenant, whatever their tenant role says (per subject, so parallel
 *     workers never see each other's setting). It models a Permit state the fixed role table cannot reach on
 *     its own - a caller who may `resolve` / `create` but holds no shared read - which is how a suite proves a
 *     service decision is made among the rows the caller can READ (Permit-aware duplicate winner).
 *
 * Workload bootstrap accepts one CI-only projected token and mints the two narrow
 * scopes the real Security API registers for this service:
 *   selection-list:owner-grant    may bootstrap list-owner only (POST)
 *   selection-list:grant-cleanup  may REVOKE (DELETE) only for a principal the
 *                                 fixture below marks gone; a live member's grant
 *                                 is refused (backend/security `principalIsGone`)
 * All human grant/revoke writes require manage_access on the exact list instance;
 * like the real gate, a human cannot revoke for a DEPARTED member (no active
 * membership), which is what the cleanup scope's fallback path exists for.
 *
 * ID FORMS (tenant and subject are canonicalised to the BARE UUID)
 *   Permit keys tenants and users by their bare UUID, and the real Security API hands `tenant` / `subject`
 *   to Permit unchanged. Depending on the service build under test, a request names the same org / user as
 *   a TypeID (`org_…` / `usr_…`) or as that TypeID's UUID. This stand-in therefore canonicalises EVERY
 *   tenant and subject it receives (decision queries, grant writes and reads, fixture calls, and the JWT
 *   claims it compares them with) to the bare UUID before it keys, compares or stores anything, so it
 *   answers identically whichever rendering arrives. Non-user principals (`svc:…`, `service:…`,
 *   `svc_token:…`, anything containing ':') are left as they are. Grants it returns carry the UUID, like
 *   Permit. A TypeID that is not codec-valid is NOT canonicalised (it names a principal nothing else can
 *   name), which is what makes a service that sends one fail its own checks instead of silently matching.
 *
 * FIXTURE ENDPOINTS (`/__fixture/*`, unauthenticated, CI-localhost only, never
 * product behaviour): let a suite act as the operator who changes the authority
 * behind the service's back (direct grant/revoke) and who deactivates a user or
 * removes a member (`gone`), and who declares the platform organization / a
 * bare-Permit tenant for `publish_platform` (see above). The real Security API
 * has no such surface.
 */
import http from 'node:http';
// The identity package is the one codec for TypeID <-> UUID (resolved through the root workspace link, like
// helpers/seed-harness.ts). CommonJS, hence the default import.
import identity from '@izzywdev/fuzefront-identity';

const { toUuid, isUuid } = identity;

const PORT = Number(process.env.PORT ?? 3002);

/** The one OAuth client this stand-in knows (CI-only fixture values, not real credentials). */
const MACHINE_CLIENT_ID = 'selection-list-service-ci';
const OWNER_GRANT_SCOPE = 'selection-list:owner-grant';
const GRANT_CLEANUP_SCOPE = 'selection-list:grant-cleanup';
const MACHINE_TOKEN_PREFIX = 'fake-machine-token:';

/**
 * The bare UUID of an `org_…` / `usr_…` TypeID (or of a UUID, lower-cased); anything else (a namespaced
 * non-user principal such as `svc:ci`, or a malformed TypeID) comes back unchanged. See "ID FORMS" above.
 */
function canon(id) {
  if (typeof id !== 'string') return id;
  if (isUuid(id)) return id.toLowerCase();
  if (/^(org|usr)_[0-9a-z]+$/.test(id)) {
    try {
      return toUuid(id);
    } catch {
      return id; // not codec-valid: names nothing else
    }
  }
  return id;
}

/** `${tenant}|${subject}` (canonical) -> 'deactivated' | 'departed' (set through /__fixture/gone). */
const gone = new Map();

/**
 * The platform organization (FuzeFront's root org) — the only tenant in which
 * `SelectionListCatalog:publish_platform` is effective (contract 4.1.0, D5).
 * Declared by env or by the /__fixture/platform-org hook; null = declared nowhere.
 */
let platformOrgId = process.env.FAKE_PLATFORM_ORG_ID ? canon(process.env.FAKE_PLATFORM_ORG_ID) : null;
/** Tenants switched to bare-Permit behaviour for publish_platform (/__fixture/publish-anywhere). */
const publishAnywhere = new Set();

/**
 * Canonical `${tenant}|${subject}` pairs that are NOT members of that tenant. Declared by the suite that needs
 * an "outsider" through `POST /__fixture/non-member` {tenant, subject} (contract/access.test.ts), never guessed
 * from id shapes; everyone else is a member of the tenant they are asked about.
 */
const NON_MEMBERS = new Set();

/** Canonical `${tenant}|${subject}|${action}` catalog actions withdrawn from one subject (/__fixture/deny-catalog-action). */
const DENIED_CATALOG_ACTIONS = new Set();

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
  // read_shared / publish_platform: contract 4.1.0 (shared + common lists).
  admin: ['list', 'create', 'read_quota', 'resolve', 'read_shared', 'publish_platform'],
  editor: ['list', 'create', 'resolve', 'read_shared'],
  viewer: ['list', 'resolve', 'read_shared'],
  developer: [],
};
/** most privileged first */
const TENANT_ROLE_ORDER = ['admin', 'editor', 'viewer', 'developer'];

/** `${tenant}|${type}:${key}|${subject}` -> Set<role> */
const grants = new Map();
let grantSeq = 0;

function grantKey(tenant, resource, subject) {
  return `${canon(tenant)}|${resource?.type ?? ''}:${resource?.key ?? ''}|${canon(subject)}`;
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
  return !NON_MEMBERS.has(`${canon(tenant)}|${canon(subject)}`);
}

/**
 * The caller's user id and org, from whichever claim names the token uses: the
 * REAL FuzeFront shapes are a session token `{userId, sessionId, tid}` and the
 * org-session token `{userId, ..., orgId, kind:'fuze-org-session'}`; the
 * Authentik-shaped `{sub, organization_id}` is kept for the published contract.
 * `tid` is the identity-directory tenant and is never read as an org.
 */
function subjectOf(claims) {
  return claims?.userId ?? claims?.sub;
}
function orgOf(claims) {
  return claims?.orgId ?? claims?.organization_id ?? claims?.organizationId;
}

/** The caller's tenant role, from the JWT `roles` claim (see header). */
function tenantRoleOf(claims, subject, tenant) {
  // Compared by canonical UUID: the token may carry either rendering, and so may the request.
  if (!(claims && canon(subjectOf(claims)) === canon(subject) && canon(orgOf(claims)) === canon(tenant))) return 'developer'; // unknowable -> least
  const roles = Array.isArray(claims.roles) ? claims.roles.map((r) => (r === 'org-admin' ? 'admin' : r)) : [];
  return TENANT_ROLE_ORDER.find((r) => roles.includes(r)) ?? 'admin';
}

function decide(q, claims) {
  const { resource, action } = q;
  const subject = canon(q.subject);
  const tenant = canon(q.tenant);
  if (!subject || !tenant || !resource?.type || !action) return false;

  if (resource.type === 'Organization') {
    return action === 'read' && isMember(tenant, subject);
  }
  if (!isMember(tenant, subject)) return false;

  // Tenant level: keyless catalog resource, tenant roles, catalog actions only.
  if (resource.type === 'SelectionListCatalog') {
    if (resource.key) return false; // the catalog has no instances
    if (!TENANT_ROLE_ACTIONS[tenantRoleOf(claims, subject, tenant)].includes(action)) return false;
    if (DENIED_CATALOG_ACTIONS.has(`${tenant}|${subject}|${action}`)) return false;
    // publish_platform is granted to tenant `admin` but only EFFECTIVE in the platform org's tenant (D5).
    if (action === 'publish_platform') return tenant === platformOrgId || publishAnywhere.has(tenant);
    return true;
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

  // Model TokenReview bootstrap with a fixture-only projected token.
  if (req.method === 'POST' && path === '/api/v1/security/tokens/workload') {
    const b = await readBody(req);
    if (b?.serviceAccountToken !== 'selection-list-service-ci-projected-token') return send(res, 401, { code: 'AUTH_REQUIRED' });
    return send(res, 200, { accessToken: `${MACHINE_TOKEN_PREFIX}${OWNER_GRANT_SCOPE}+${GRANT_CLEANUP_SCOPE}`, tokenType: 'Bearer', expiresIn: 300 });
  }

  // Operator fixture surface (see header). Declared before authentication on purpose.
  if (path === '/__fixture/gone' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b?.tenant || !b?.subject) return send(res, 400, { code: 'MALFORMED' });
    gone.set(`${canon(b.tenant)}|${canon(b.subject)}`, b.kind === 'departed' ? 'departed' : 'deactivated');
    return send(res, 204);
  }
  if (path === '/__fixture/platform-org' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b || typeof b.orgId !== 'string' || !(/^org_[0-9a-z]+$/.test(b.orgId) || isUuid(b.orgId))) return send(res, 400, { code: 'MALFORMED' });
    platformOrgId = canon(b.orgId);
    return send(res, 204);
  }
  if (path === '/__fixture/non-member' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b || typeof b.tenant !== 'string' || typeof b.subject !== 'string') return send(res, 400, { code: 'MALFORMED' });
    NON_MEMBERS.add(`${canon(b.tenant)}|${canon(b.subject)}`);
    return send(res, 204);
  }
  if (path === '/__fixture/deny-catalog-action' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b || typeof b.tenant !== 'string' || typeof b.subject !== 'string' || typeof b.action !== 'string') return send(res, 400, { code: 'MALFORMED' });
    DENIED_CATALOG_ACTIONS.add(`${canon(b.tenant)}|${canon(b.subject)}|${b.action}`);
    return send(res, 204);
  }
  if (path === '/__fixture/publish-anywhere' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b || typeof b.tenant !== 'string') return send(res, 400, { code: 'MALFORMED' });
    publishAnywhere.add(canon(b.tenant));
    return send(res, 204);
  }
  if (path === '/__fixture/grants' && (req.method === 'POST' || req.method === 'DELETE')) {
    const b = await readBody(req);
    if (!b?.tenant || !b?.subject || !b?.role || !b?.resource) return send(res, 400, { code: 'MALFORMED' });
    const k = grantKey(b.tenant, b.resource, b.subject);
    const roles = grants.get(k) ?? new Set();
    if (req.method === 'POST') roles.add(b.role); else roles.delete(b.role);
    if (roles.size === 0) grants.delete(k); else grants.set(k, roles);
    return send(res, req.method === 'POST' ? 201 : 204);
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
    return send(res, 200, { allow: decide({ ...body, subject: body.subject || subjectOf(claims) }, claims) });
  }

  if (req.method === 'POST' && path === '/api/v1/security/authz/bulk-check') {
    const body = await readBody(req);
    if (!body || !Array.isArray(body.checks) || body.checks.length < 1 || body.checks.length > 200) {
      return send(res, 400, { error: 'Malformed checks', code: 'MALFORMED' });
    }
    return send(res, 200, {
      decisions: body.checks.map((c) => ({ allow: decide({ ...c, subject: c.subject || subjectOf(claims) }, claims) })),
    });
  }

  if (path === '/api/v1/security/authz/grants') {
    if (req.method === 'POST') {
      const b = await readBody(req);
      const scopes = machineScopesOf(req);
      const bootstrap = scopes?.includes(OWNER_GRANT_SCOPE) && b?.role === 'list-owner';
      const manager = !scopes && b?.resource && decide({ subject: subjectOf(claims), tenant: b.tenant, resource: b.resource, action: 'manage_access' }, claims);
      if (!bootstrap && !manager) return send(res, 403, { code: 'FORBIDDEN' });

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
        subject: canon(b.subject),
        tenant: canon(b.tenant),
        role: b.role,
        resource: b.resource,
        createdAt: Date.now(),
      });
    }
    if (req.method === 'DELETE') {
      const b = await readBody(req);
      const scopes = machineScopesOf(req);
      // Cleanup workload: revoke-only, and only for a principal that is gone.
      const cleanup = scopes?.includes(GRANT_CLEANUP_SCOPE) && gone.has(`${canon(b?.tenant)}|${canon(b?.subject)}`);
      // Human: exact-instance manage_access, and (like the real gate) no revoke for a departed member.
      const manager = !scopes && b?.resource && gone.get(`${canon(b.tenant)}|${canon(b.subject)}`) !== 'departed' &&
        decide({ subject: subjectOf(claims), tenant: b.tenant, resource: b.resource, action: 'manage_access' }, claims);
      if (!cleanup && !manager) return send(res, 403, { code: 'FORBIDDEN' });

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
      const rawTenant = url.searchParams.get('tenant');
      if (!rawTenant) return send(res, 400, { error: 'tenant is required', code: 'MALFORMED' });
      const tenant = canon(rawTenant);
      const subject = canon(url.searchParams.get('subject') || subjectOf(claims));
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
