/**
 * The GET half of the config-service HTTP surface (FFRNT-157 / FF-EPIC-17-S5,
 * plus `listConfigHistory` from FF-EPIC-18 / FFRNT-280):
 *
 *   GET /v1/namespaces
 *   GET /v1/namespaces/{namespace}/keys
 *   GET /v1/namespaces/{namespace}/keys/{key}
 *   GET /v1/config
 *   GET /v1/config/history
 *
 * Mutations (PUT /v1/config, POST/PUT /v1/namespaces*, and the reveal-once
 * POST /v1/config/secrets/reveal) live in FFRNT-158's write router, mounted
 * separately at the same `app.use('/v1', ...)`-adjacent extension point in
 * src/app.ts — this module owns every GET route on the surface, per
 * services/config-service/openapi.yaml, the frozen contract.
 */

import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { NamespaceRepository } from '../repositories/namespace.repository';
import { KeyDefinitionRepository } from '../repositories/key-definition.repository';
import { ValueRepository } from '../repositories/value.repository';
import { HistoryRepository } from '../repositories/history.repository';
import { resolveEffectiveConfig } from '../resolver/resolve';
import { requireAuth } from '../middleware/auth';
import { CONFIG_CATALOG_RESOURCE, CONFIG_SCOPE_RESOURCE, checkAuthorization, requireConfigPermission } from '../middleware/authz';
import { parseLimit } from '../pagination';
import { ConfigHistoryEntry, EffectiveConfigEntry, KeyDefinition, Scope, ScopeType } from '../types';

export interface ConfigReadRouterDeps {
  namespaceRepo: NamespaceRepository;
  keyDefinitionRepo: KeyDefinitionRepository;
  valueRepo: ValueRepository;
  historyRepo: HistoryRepository;
}

const VALID_SCOPE_TYPES: ScopeType[] = ['platform', 'portal', 'org', 'user'];

function errorBody(code: string, message: string, extra?: Record<string, unknown>) {
  return { code, message, ...extra };
}

/**
 * Strips internal-only fields (namespaceId, createdAt, updatedAt) that this
 * service's `KeyDefinition` type carries but `openapi.yaml`'s `KeyDefinition`
 * schema does not declare — the wire response is exactly the contract shape,
 * not a leak of implementation detail.
 */
function serializeKeyDefinition(def: KeyDefinition): Record<string, unknown> {
  return {
    id: def.id,
    key: def.key,
    displayName: def.displayName,
    description: def.description,
    helpUrl: def.helpUrl,
    category: def.category,
    sortOrder: def.sortOrder,
    tags: def.tags,
    valueType: def.valueType,
    schema: def.schema,
    enumValues: def.enumValues,
    defaultValue: def.defaultValue,
    allowedScopes: def.allowedScopes,
    isSystem: def.isSystem,
    isHidden: def.isHidden,
    isSecret: def.isSecret,
    isReadonly: def.isReadonly,
    precedence: def.precedence,
    requiresRestart: def.requiresRestart,
    deprecatedAt: def.deprecatedAt,
    replacedBy: def.replacedBy,
  };
}

function serializeEntry(entry: EffectiveConfigEntry): Record<string, unknown> {
  return {
    key: entry.key,
    value: entry.value,
    ...(entry.isSet !== undefined ? { isSet: entry.isSet } : {}),
    source: entry.source,
    locked: entry.locked,
    lockedBy: entry.lockedBy,
    lockReason: entry.lockReason,
    editable: entry.editable,
    warning: entry.warning,
    definition: serializeKeyDefinition(entry.definition),
  };
}

/**
 * Builds the resolution chain for a target scope (resolve.ts: "assembling
 * this chain ... is the caller's job").
 *
 * config-service does not own the portal/org/user hierarchy (that data lives
 * in other services' databases — CLAUDE.md: "no cross-service FK / no writes
 * into another service's tables") and the frozen contract's `GET /v1/config`
 * accepts only a single (scopeType, scopeId) pair, not a caller-supplied
 * ancestor chain. So THIS implementation resolves exactly the tiers it can
 * verify from the request itself: `platform` (always) plus the requested
 * scope. It deliberately does NOT attempt to guess an org's portal or a
 * user's org — a wrong guess would be worse than an honest gap. Wiring a real
 * ancestor chain (which portal an org belongs to, which org a user belongs
 * to) is the FF-EPIC-10 context-resolution assumption resolve.ts's own
 * doc-comment names, and is not yet delivered to this service; extending this
 * function is the natural landing point once it is.
 */
function buildScopeChain(target: Scope): Scope[] {
  const platform: Scope = { scopeType: 'platform', scopeId: null };
  if (target.scopeType === 'platform') return [platform];
  return [platform, target];
}

/**
 * Best-effort authz tenant for a scope: an org scope IS its own tenant; other
 * tiers fall back to the caller's own org context, or a fixed 'platform'
 * tenant when none is known. Exported so the reveal-once write route
 * (src/routes/secrets.write.ts) derives a tenant the SAME way for its own
 * `ConfigScope` check — one rule, not two that could silently drift apart.
 */
export function deriveTenant(scope: Scope, req: Request): string {
  if (scope.scopeType === 'org' && scope.scopeId) return scope.scopeId;
  return req.orgId ?? 'platform';
}

function serializeHistoryEntry(entry: ConfigHistoryEntry): Record<string, unknown> {
  return {
    id: entry.id,
    namespace: entry.namespace,
    key: entry.key,
    scope: entry.scope,
    action: entry.action,
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    redacted: entry.redacted,
    actor: entry.actor,
    reason: entry.reason,
    revertOf: entry.revertOf,
    occurredAt: entry.occurredAt,
  };
}

export function createConfigReadRouter(deps: ConfigReadRouterDeps): Router {
  const router = Router();
  const { namespaceRepo, keyDefinitionRepo, valueRepo, historyRepo } = deps;

  // ── GET /v1/namespaces ──────────────────────────────────────────────────
  router.get(
    '/namespaces',
    requireAuth,
    requireConfigPermission(CONFIG_CATALOG_RESOURCE, 'read'),
    async (req: Request, res: Response) => {
      const limit = parseLimit(req.query.limit);
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

      try {
        const page = await namespaceRepo.listPage({ limit, cursor });
        res.status(200).json({ items: page.items, pageInfo: page.pageInfo });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[GET /v1/namespaces] error', err);
        res.status(500).json(errorBody('VALIDATION_ERROR', 'Failed to list namespaces.'));
      }
    },
  );

  // ── GET /v1/namespaces/:namespace/keys ──────────────────────────────────
  router.get(
    '/namespaces/:namespace/keys',
    requireAuth,
    requireConfigPermission(CONFIG_CATALOG_RESOURCE, 'read', (req) => req.params.namespace),
    async (req: Request, res: Response) => {
      const { namespace: namespaceName } = req.params;
      const includeHidden = String(req.query.includeHidden ?? '') === 'true';

      if (includeHidden) {
        // openapi.yaml: "Permitted only for platform administrators; any
        // other caller passing `true` is refused with 403 rather than
        // silently receiving a filtered list." A dedicated 'admin' action
        // check, on top of the 'read' check above.
        const isAdmin = await checkAuthorization(req, CONFIG_CATALOG_RESOURCE, 'admin', namespaceName);
        if (!isAdmin) {
          res.status(403).json(errorBody('FORBIDDEN', 'includeHidden is restricted to platform administrators.'));
          return;
        }
      }

      const namespace = await namespaceRepo.findByName(namespaceName);
      if (!namespace) {
        res.status(404).json(errorBody('NOT_FOUND', `No such namespace '${namespaceName}'.`));
        return;
      }

      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const category = typeof req.query.category === 'string' ? req.query.category : undefined;
      const limit = parseLimit(req.query.limit);
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

      try {
        const page = await keyDefinitionRepo.listPage(namespace.id, {
          limit,
          cursor,
          search,
          category,
          includeHidden,
        });
        res.status(200).json({
          items: page.items.map(serializeKeyDefinition),
          pageInfo: page.pageInfo,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[GET /v1/namespaces/:namespace/keys] error', err);
        res.status(500).json(errorBody('VALIDATION_ERROR', 'Failed to list key definitions.'));
      }
    },
  );

  // ── GET /v1/namespaces/:namespace/keys/:key ─────────────────────────────
  router.get(
    '/namespaces/:namespace/keys/:key',
    requireAuth,
    requireConfigPermission(CONFIG_CATALOG_RESOURCE, 'read', (req) => req.params.namespace),
    async (req: Request, res: Response) => {
      const { namespace: namespaceName, key } = req.params;

      const namespace = await namespaceRepo.findByName(namespaceName);
      if (!namespace) {
        res.status(404).json(errorBody('NOT_FOUND', `No such namespace '${namespaceName}'.`));
        return;
      }

      const definition = await keyDefinitionRepo.findByKey(namespace.id, key);
      // Hidden keys are 404 — the SAME response an absent key produces, so
      // this endpoint never confirms the existence of a key the caller may
      // not see (openapi.yaml `getKeyDefinition`).
      if (!definition || definition.isHidden) {
        res.status(404).json(errorBody('NOT_FOUND', `No such key '${key}' in namespace '${namespaceName}'.`));
        return;
      }

      res.status(200).json(serializeKeyDefinition(definition));
    },
  );

  // ── GET /v1/config ───────────────────────────────────────────────────────
  router.get('/config', requireAuth, async (req: Request, res: Response) => {
    const namespaceName = typeof req.query.namespace === 'string' ? req.query.namespace : undefined;
    const scopeTypeRaw = typeof req.query.scopeType === 'string' ? req.query.scopeType : undefined;
    const scopeIdRaw = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;

    if (!namespaceName) {
      res.status(400).json(
        errorBody('VALIDATION_ERROR', 'namespace is required.', {
          details: [{ key: null, field: 'namespace', message: 'namespace is required.', allowedValues: null }],
        }),
      );
      return;
    }
    if (!scopeTypeRaw || !VALID_SCOPE_TYPES.includes(scopeTypeRaw as ScopeType)) {
      res.status(400).json(
        errorBody('VALIDATION_ERROR', 'scopeType must be one of platform, portal, org, user.', {
          details: [
            {
              key: null,
              field: 'scopeType',
              message: 'scopeType must be one of platform, portal, org, user.',
              allowedValues: VALID_SCOPE_TYPES,
            },
          ],
        }),
      );
      return;
    }
    const scopeType = scopeTypeRaw as ScopeType;
    if (scopeType === 'platform' && scopeIdRaw) {
      res.status(400).json(
        errorBody('VALIDATION_ERROR', 'scopeId must be omitted when scopeType is platform.', {
          details: [{ key: null, field: 'scopeId', message: 'must be omitted for platform', allowedValues: null }],
        }),
      );
      return;
    }
    if (scopeType !== 'platform' && !scopeIdRaw) {
      res.status(400).json(
        errorBody('VALIDATION_ERROR', 'scopeId is required unless scopeType is platform.', {
          details: [{ key: null, field: 'scopeId', message: 'scopeId is required', allowedValues: null }],
        }),
      );
      return;
    }

    const targetScope: Scope = { scopeType, scopeId: scopeType === 'platform' ? null : (scopeIdRaw as string) };

    // The authz check happens BEFORE any existence check: a caller with no
    // authority over the requested scope gets 403 and learns nothing about
    // whether the namespace/scope exists (openapi.yaml `Forbidden`, S5 AC4).
    const allowed = await checkAuthorization(req, CONFIG_SCOPE_RESOURCE, 'read', `${namespaceName}:${scopeType}:${scopeIdRaw ?? 'platform'}`, deriveTenant(targetScope, req));
    if (!allowed) {
      res.status(403).json(errorBody('FORBIDDEN', 'Permission denied.'));
      return;
    }

    const namespace = await namespaceRepo.findByName(namespaceName);
    if (!namespace) {
      res.status(404).json(errorBody('NOT_FOUND', `No such namespace '${namespaceName}'.`));
      return;
    }

    try {
      const definitions = await keyDefinitionRepo.listByNamespace(namespace.id);
      const chain = buildScopeChain(targetScope);
      const definitionIds = definitions.map((d) => d.id);
      const values = await valueRepo.listForDefinitions(definitionIds, chain);
      const entries = resolveEffectiveConfig({ chain, definitions, values });

      const version = computeVersion(namespaceName, targetScope, entries);
      const ifNoneMatch = normalizeETag(req.headers['if-none-match']);
      if (ifNoneMatch && ifNoneMatch === version) {
        res.status(304).setHeader('ETag', `"${version}"`).end();
        return;
      }

      res.status(200).setHeader('ETag', `"${version}"`).json({
        namespace: namespaceName,
        scope: targetScope,
        version,
        entries: entries.map(serializeEntry),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[GET /v1/config] error', err);
      res.status(500).json(errorBody('VALIDATION_ERROR', 'Failed to resolve configuration.'));
    }
  });

  // ── GET /v1/config/history ───────────────────────────────────────────────
  // openapi.yaml `listConfigHistory`: the append-only change trail for ONE
  // key at ONE exact scope. Sibling of GET /v1/config above — same
  // namespace/scopeType/scopeId validation, but additionally requires `key`
  // and gates on a distinct 'audit' action (openapi.yaml Forbidden: "no
  // **audit** grant... distinct from the write/read grants on the value
  // itself"), never on the 'read'/'admin' actions the rest of this router
  // uses.
  router.get('/config/history', requireAuth, async (req: Request, res: Response) => {
    const namespaceName = typeof req.query.namespace === 'string' ? req.query.namespace : undefined;
    const scopeTypeRaw = typeof req.query.scopeType === 'string' ? req.query.scopeType : undefined;
    const scopeIdRaw = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
    const key = typeof req.query.key === 'string' ? req.query.key : undefined;

    if (!namespaceName) {
      res.status(400).json(
        errorBody('VALIDATION_ERROR', 'namespace is required.', {
          details: [{ key: null, field: 'namespace', message: 'namespace is required.', allowedValues: null }],
        }),
      );
      return;
    }
    if (!scopeTypeRaw || !VALID_SCOPE_TYPES.includes(scopeTypeRaw as ScopeType)) {
      res.status(400).json(
        errorBody('VALIDATION_ERROR', 'scopeType must be one of platform, portal, org, user.', {
          details: [
            {
              key: null,
              field: 'scopeType',
              message: 'scopeType must be one of platform, portal, org, user.',
              allowedValues: VALID_SCOPE_TYPES,
            },
          ],
        }),
      );
      return;
    }
    const scopeType = scopeTypeRaw as ScopeType;
    if (scopeType === 'platform' && scopeIdRaw) {
      res.status(400).json(
        errorBody('VALIDATION_ERROR', 'scopeId must be omitted when scopeType is platform.', {
          details: [{ key: null, field: 'scopeId', message: 'must be omitted for platform', allowedValues: null }],
        }),
      );
      return;
    }
    if (scopeType !== 'platform' && !scopeIdRaw) {
      res.status(400).json(
        errorBody('VALIDATION_ERROR', 'scopeId is required unless scopeType is platform.', {
          details: [{ key: null, field: 'scopeId', message: 'scopeId is required', allowedValues: null }],
        }),
      );
      return;
    }
    if (!key) {
      res.status(400).json(
        errorBody('VALIDATION_ERROR', 'key is required.', {
          details: [{ key: null, field: 'key', message: 'key is required.', allowedValues: null }],
        }),
      );
      return;
    }

    const targetScope: Scope = { scopeType, scopeId: scopeType === 'platform' ? null : (scopeIdRaw as string) };

    // Authz BEFORE any existence check, same discipline as GET /v1/config
    // above — a caller with no audit authority learns nothing about whether
    // the namespace/key/scope exists. 'audit' is a DISTINCT action from
    // 'read' (openapi.yaml: seeing/changing a setting does not imply seeing
    // who changed it and why).
    const allowed = await checkAuthorization(
      req,
      CONFIG_SCOPE_RESOURCE,
      'audit',
      `${namespaceName}:${scopeType}:${scopeIdRaw ?? 'platform'}`,
      deriveTenant(targetScope, req),
    );
    if (!allowed) {
      res.status(403).json(
        errorBody('FORBIDDEN', 'No audit grant over the requested scope.'),
      );
      return;
    }

    const namespace = await namespaceRepo.findByName(namespaceName);
    if (!namespace) {
      res.status(404).json(errorBody('NOT_FOUND', `No such namespace '${namespaceName}'.`));
      return;
    }

    const definition = await keyDefinitionRepo.findByKey(namespace.id, key);
    // Hidden keys are 404 — same masking rule as getKeyDefinition/GET
    // /v1/config above: this endpoint never confirms the existence of a key
    // the caller may not otherwise see.
    if (!definition || definition.isHidden) {
      res.status(404).json(errorBody('NOT_FOUND', `No such key '${key}' in namespace '${namespaceName}'.`));
      return;
    }

    const limit = parseLimit(req.query.limit);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    try {
      const page = await historyRepo.listPage({ namespace: namespaceName, key, scope: targetScope, limit, cursor });
      res.status(200).json({
        items: page.items.map(serializeHistoryEntry),
        pageInfo: page.pageInfo,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[GET /v1/config/history] error', err);
      res.status(500).json(errorBody('VALIDATION_ERROR', 'Failed to list history.'));
    }
  });

  return router;
}

/** Strips the ETag quoting/weak-validator prefix so a raw comparison against `version` works. Returns null for anything unparseable — treated as "no If-None-Match" per openapi.yaml. */
function normalizeETag(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const trimmed = value.trim().replace(/^W\//, '');
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  return unquoted || null;
}

/**
 * Version of the RESOLVED view (openapi.yaml: "changes when an ancestor
 * changes too"). A content hash of the actual resolved entries — deliberately
 * NOT a hash of only this scope's own rows, so an ancestor-scope change (a
 * different `source`/`locked`/`value` in the resolved output) changes the
 * hash exactly because it changes the entries being hashed. Namespace + scope
 * are folded in too, so two different (namespace, scope) pairs that happen to
 * resolve to byte-identical entries never collide on a shared ETag.
 */
function computeVersion(namespace: string, scope: Scope, entries: EffectiveConfigEntry[]): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ namespace, scope, entries }));
  return hash.digest('hex');
}
