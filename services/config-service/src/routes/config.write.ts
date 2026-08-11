/**
 * PUT /v1/config — `writeConfigValues` (FFRNT-158 / FF-EPIC-17-S6).
 * GET /v1/config is FFRNT-157's (a sibling route module) — this file owns
 * the write half only.
 *
 * Applies a batch of `set` / `unset` / `lock` / `unlock` operations to ONE
 * scope as a single transaction: every check below (shape, key existence,
 * `isReadonly`, `allowedScopes`, value schema, authorization,
 * `expectedVersion`, ancestor lock) runs BEFORE the transaction opens, so a
 * batch that will fail never writes anything — see docs/planning/epics/
 * EPIC-17-configuration-service-core.md S6 AC3 ("no key is written").
 *
 * `unset` vs "set to the parent's current value" (the single highest-risk
 * item flagged for this story): `unset` calls
 * `ValueRepository.unsetValue` — DELETEs this scope's row, so resolution
 * keeps tracking whatever the parent resolves to next. `set` (even with a
 * value equal to today's inherited value) INSERTs/UPDATEs a row that stops
 * tracking the parent from that moment on. The two are wired to entirely
 * different repository calls below and are exercised as DISTINCT persisted
 * states in tests/routes/config.write.test.ts.
 */

import { Router, Request, Response } from 'express';
import { Pool, PoolClient } from 'pg';
import { requireAuth } from '../middleware/auth';
import { checkConfigPermission, ConfigAction } from '../middleware/permit';
import { PgNamespaceRepository } from '../repositories/namespace.repository';
import { PgKeyDefinitionRepository } from '../repositories/key-definition.repository';
import {
  InvalidScopeReferenceError,
  PgValueRepository,
  ScopeNotAllowedError,
} from '../repositories/value.repository';
import { validateValue } from '../validation/schema';
import { validateWriteRequestShape } from '../validation/requestShapes';
import { buildWriteChain, findAncestorLock, findRowAtTargetScope } from '../services/scope-chain';
import { computeResolvedVersion } from '../services/version';
import { ErrorDetail, sendError } from '../http/errors';
import { ConfigValue, KeyDefinition, Scope } from '../types';

interface ConfigOperationInput {
  key: string;
  op: 'set' | 'unset' | 'lock' | 'unlock';
  value?: unknown;
  lockReason?: string;
}

interface ConfigWriteRequestInput {
  namespace: string;
  scope: Scope;
  operations: ConfigOperationInput[];
  expectedVersion?: string;
  reason?: string;
}

class NothingToUnlockError extends Error {
  constructor(public readonly key: string) {
    super(`nothing to unlock for key '${key}' at this scope`);
    this.name = 'NothingToUnlockError';
  }
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function createConfigWriteRouter(pool: Pool): Router {
  const namespaces = new PgNamespaceRepository(pool);
  const keyDefs = new PgKeyDefinitionRepository(pool);
  const values = new PgValueRepository(pool);

  const router = Router();

  router.put('/v1/config', requireAuth, async (req: Request, res: Response) => {
    const principal = req.principal!;

    // ── 1. Structural shape (400). ──────────────────────────────────────────
    const shape = validateWriteRequestShape(req.body);
    if (!shape.valid) {
      sendError(res, 400, {
        code: 'VALIDATION_ERROR',
        message: 'Malformed write request.',
        details: shape.errors.map((m) => ({ message: m })),
      });
      return;
    }
    const body = req.body as ConfigWriteRequestInput;

    // The Scope schema allows `scopeId` to be string|null structurally;
    // enforce the null-exactly-when-platform invariant here (openapi.yaml
    // Scope.scopeId description).
    const scopeIdInvalid =
      body.scope.scopeType === 'platform' ? body.scope.scopeId != null : body.scope.scopeId == null;
    if (scopeIdInvalid) {
      sendError(res, 400, {
        code: 'VALIDATION_ERROR',
        message: 'scopeId must be null exactly when scopeType is platform.',
        details: [{ field: 'scope.scopeId', message: 'invalid for this scopeType' }],
      });
      return;
    }

    // Per-operation `value`/`lockReason` presence rules + duplicate keys.
    const seenKeys = new Set<string>();
    const shapeErrors: ErrorDetail[] = [];
    for (const op of body.operations) {
      const opHasValue = hasOwn(op, 'value');
      const opHasLockReason = hasOwn(op, 'lockReason');
      if ((op.op === 'set' || op.op === 'lock') && !opHasValue) {
        shapeErrors.push({ key: op.key, message: `'value' is required for op '${op.op}'` });
      }
      if ((op.op === 'unset' || op.op === 'unlock') && opHasValue) {
        shapeErrors.push({ key: op.key, message: `'value' is not accepted for op '${op.op}'` });
      }
      if (op.op !== 'lock' && opHasLockReason) {
        shapeErrors.push({ key: op.key, message: `'lockReason' is only accepted for op 'lock'` });
      }
      if (seenKeys.has(op.key)) {
        shapeErrors.push({ key: op.key, message: 'duplicate operation for this key in one batch' });
      }
      seenKeys.add(op.key);
    }
    if (shapeErrors.length > 0) {
      sendError(res, 400, {
        code: 'VALIDATION_ERROR',
        message: 'One or more operations are invalid. Nothing was applied.',
        details: shapeErrors,
      });
      return;
    }

    // ── 2. Namespace + key definitions (404 / 400). ─────────────────────────
    const namespace = await namespaces.findByName(body.namespace);
    if (!namespace) {
      sendError(res, 404, { code: 'NOT_FOUND', message: `no such namespace '${body.namespace}'` });
      return;
    }

    const definitions = await keyDefs.listByNamespace(namespace.id);
    const byKey = new Map<string, KeyDefinition>(definitions.map((d) => [d.key, d]));
    const missingKeys = body.operations.filter((op) => !byKey.has(op.key));
    if (missingKeys.length > 0) {
      sendError(res, 400, {
        code: 'VALIDATION_ERROR',
        message: 'One or more keys do not exist in this namespace. Nothing was applied.',
        details: missingKeys.map((op) => ({ key: op.key, message: 'no such key in this namespace' })),
      });
      return;
    }

    // ── 3. Authorization (403), BEFORE any fine-grained validation. ─────────
    // Deliberately ordered ahead of step 4 below: openapi.yaml's `Forbidden`
    // response promises a denial "does not reveal whether [a] scope exists",
    // and an unauthorized caller must not learn which of their keys/values
    // would have been valid before learning they had no authority at all.
    // Write authority is distinct from lock authority, and from system-key
    // authority — see src/middleware/permit.ts.
    const requiredActions = new Set<ConfigAction>();
    for (const op of body.operations) {
      const def = byKey.get(op.key)!;
      requiredActions.add(op.op === 'lock' || op.op === 'unlock' ? 'lock' : 'write');
      if (def.isSystem) requiredActions.add('write-system');
    }
    const resourceKey = `${body.namespace}:${body.scope.scopeType}:${body.scope.scopeId ?? 'singleton'}`;
    for (const action of requiredActions) {
      const allowed = await checkConfigPermission(principal.userId, action, resourceKey);
      if (!allowed) {
        sendError(res, 403, {
          code: 'FORBIDDEN',
          message: `Not permitted to '${action}' configuration at this scope.`,
        });
        return;
      }
    }

    // ── 4. isReadonly / allowedScopes / value-schema (400 / 422). ───────────
    const validationErrors: ErrorDetail[] = [];
    let scopeNotAllowedKey: string | null = null;
    for (const op of body.operations) {
      const def = byKey.get(op.key)!;
      if ((op.op === 'set' || op.op === 'lock') && def.isReadonly) {
        validationErrors.push({ key: op.key, message: 'key is read-only and cannot be modified at any scope' });
        continue;
      }
      if (!def.allowedScopes.includes(body.scope.scopeType)) {
        scopeNotAllowedKey = scopeNotAllowedKey ?? op.key;
        continue;
      }
      if (op.op === 'set' || op.op === 'lock') {
        const result = validateValue(def.valueType, op.value, { schema: def.schema, enumValues: def.enumValues });
        if (!result.valid) {
          validationErrors.push({
            key: op.key,
            message: result.errors.join('; '),
            allowedValues: result.allowedValues ?? null,
          });
        }
      }
    }
    if (validationErrors.length > 0) {
      sendError(res, 400, {
        code: 'VALIDATION_ERROR',
        message: 'One or more values are invalid. Nothing was applied.',
        details: validationErrors,
      });
      return;
    }
    if (scopeNotAllowedKey) {
      sendError(res, 422, {
        code: 'SCOPE_NOT_ALLOWED',
        message: `key '${scopeNotAllowedKey}' may not be set at scope '${body.scope.scopeType}'. Nothing was applied.`,
      });
      return;
    }

    // ── 5. expectedVersion + ancestor-lock (409). See src/services/scope-chain.ts ─
    // for the documented limitation on ancestor resolution.
    const chain = buildWriteChain(body.scope, { portalId: principal.portalId, orgId: principal.orgId });
    const allValues = await values.listForDefinitions(
      definitions.map((d) => d.id),
      chain,
    );
    const currentVersion = computeResolvedVersion(allValues);

    if (body.expectedVersion !== undefined && body.expectedVersion !== currentVersion) {
      sendError(res, 409, {
        code: 'VERSION_CONFLICT',
        message: 'The resolved view changed since expectedVersion. Nothing was applied.',
        currentVersion,
      });
      return;
    }

    const rowsByDefinition = new Map<string, ConfigValue[]>();
    for (const row of allValues) {
      const list = rowsByDefinition.get(row.definitionId) ?? [];
      list.push(row);
      rowsByDefinition.set(row.definitionId, list);
    }
    for (const op of body.operations) {
      const def = byKey.get(op.key)!;
      const rows = rowsByDefinition.get(def.id) ?? [];
      const lockedBy = findAncestorLock(chain, rows);
      if (lockedBy) {
        sendError(res, 409, {
          code: 'LOCKED_BY_ANCESTOR',
          message: `key '${op.key}' is locked by an ancestor scope. Nothing was applied.`,
          lockedBy,
        });
        return;
      }
    }

    // ── 6. Apply the batch atomically. ───────────────────────────────────────
    const client: PoolClient = await pool.connect();
    const applied: string[] = [];
    try {
      await client.query('BEGIN');
      const txValues = new PgValueRepository(client as unknown as Pool);

      for (const op of body.operations) {
        const def = byKey.get(op.key)!;
        switch (op.op) {
          case 'set':
            await txValues.setValue({
              definitionId: def.id,
              allowedScopes: def.allowedScopes,
              scope: body.scope,
              value: op.value,
              isLocked: false,
              lockReason: null,
              setByUserId: principal.userId,
            });
            break;
          case 'unset':
            // Deliberately unsetValue(), NOT setValue() with the parent's
            // current value — see module doc.
            await txValues.unsetValue(def.id, body.scope);
            break;
          case 'lock':
            await txValues.setValue({
              definitionId: def.id,
              allowedScopes: def.allowedScopes,
              scope: body.scope,
              value: op.value,
              isLocked: true,
              lockReason: op.lockReason ?? null,
              setByUserId: principal.userId,
            });
            break;
          case 'unlock': {
            // Un-pins the lock but PRESERVES whatever value is there — unlock
            // is "stop blocking descendants", not "remove my override" (that
            // is `unset`).
            const rows = rowsByDefinition.get(def.id) ?? [];
            const existing = findRowAtTargetScope(chain, rows);
            if (!existing) {
              throw new NothingToUnlockError(op.key);
            }
            await txValues.setValue({
              definitionId: def.id,
              allowedScopes: def.allowedScopes,
              scope: body.scope,
              value: existing.value,
              isLocked: false,
              lockReason: null,
              setByUserId: principal.userId,
            });
            break;
          }
        }
        applied.push(op.key);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();

      if (err instanceof NothingToUnlockError) {
        sendError(res, 400, {
          code: 'VALIDATION_ERROR',
          message: `nothing to unlock for key '${err.key}' at this scope. Nothing was applied.`,
          details: [{ key: err.key, message: 'no value/lock exists at this scope' }],
        });
        return;
      }
      if (err instanceof InvalidScopeReferenceError) {
        sendError(res, 400, {
          code: 'VALIDATION_ERROR',
          message: `scope reference is invalid: ${err.message}. Nothing was applied.`,
        });
        return;
      }
      if (err instanceof ScopeNotAllowedError) {
        sendError(res, 422, {
          code: 'SCOPE_NOT_ALLOWED',
          message: `${err.message}. Nothing was applied.`,
        });
        return;
      }
      // eslint-disable-next-line no-console
      console.error('[config-service] write transaction failed', err);
      res.status(500).json({ error: 'internal_error', message: 'Unexpected failure applying the write; nothing was applied.' });
      return;
    }
    client.release();

    const afterValues = await values.listForDefinitions(
      definitions.map((d) => d.id),
      chain,
    );
    const newVersion = computeResolvedVersion(afterValues);

    res.status(200).json({
      namespace: body.namespace,
      scope: body.scope,
      version: newVersion,
      applied,
    });
  });

  return router;
}
