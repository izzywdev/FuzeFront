/**
 * POST /v1/config/secrets/reveal — `revealSecret` (FF-EPIC-18 / FFRNT-280).
 *
 * Reveal-once disclosure of an `isSecret` value's plaintext. This is
 * deliberately its OWN high-privilege action, never a field on
 * `EffectiveConfigEntry` or any GET (openapi.yaml `revealSecret`):
 *
 *   - Authorization is a DISTINCT grant ('reveal') from both the ordinary
 *     read grant ('read', GET /v1/config) and the write grant ('write',
 *     PUT /v1/config) — an operator who may Replace a credential does not
 *     automatically get to Reveal it. Decided the SAME way every other
 *     scope-level check in this service is: `checkAuthorization()` against
 *     FuzeFront's Security API (never "the caller supplied the right
 *     namespace/scope/key" — an id, or an address built from ids, is NEVER a
 *     capability; see CLAUDE.md "Entity identifiers").
 *   - FAIL CLOSED throughout: a denied/undecidable authz check is 403, same
 *     discipline as src/middleware/authz.ts's `checkAuthorization()`.
 *   - Throttled independently of ordinary reads/writes (429 RATE_LIMITED) —
 *     see `RevealRateLimiter` below. A successful call discloses a live
 *     credential, so this is deliberately throttled HARDER than an ordinary
 *     read, per openapi.yaml's `429` response.
 *   - Every attempt against a real, resolved secret — success or failure —
 *     writes its OWN `reveal` entry to `GET /v1/config/history` (the audit
 *     trail), never a formality: see the `recordReveal` calls below.
 *
 * NOT implemented in this PR, and named here rather than silently assumed:
 * `isSecret` values are stored and read back as plaintext JSONB, same as
 * every other value type (src/repositories/value.repository.ts) — this PR
 * adds the reveal-once AUTHORIZATION/AUDIT contract, not encryption-at-rest.
 * That gap PREDATES this PR (S6/FFRNT-158's PUT /v1/config already stores
 * `isSecret` values this way) and is out of THIS PR's scope — encrypting at
 * rest needs a key-management decision (KMS/vault integration, a migration
 * for already-stored values) this change does not make. `decryptSecretValue`
 * below is the seam a future encryption change hangs off: today it never
 * throws, so the contract's `409 SECRET_UNAVAILABLE` path is wired but not
 * yet reachable — same "documented limitation, not silently assumed" pattern
 * src/services/scope-chain.ts already uses for its own known gap.
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { requireAuth } from '../middleware/auth';
import { CONFIG_SCOPE_RESOURCE, checkAuthorization } from '../middleware/authz';
import { deriveTenant } from './config-read.routes';
import { PgNamespaceRepository } from '../repositories/namespace.repository';
import { PgKeyDefinitionRepository } from '../repositories/key-definition.repository';
import { PgValueRepository } from '../repositories/value.repository';
import { PgHistoryRepository } from '../repositories/history.repository';
import { validateRevealSecretRequestShape } from '../validation/requestShapes';
import { sendError } from '../http/errors';
import { Scope } from '../types';

interface RevealSecretRequestInput {
  namespace: string;
  scope: Scope;
  key: string;
  reason: string;
}

/**
 * Reveal-once decryption seam. A no-op today (values are stored as plain
 * JSONB — see the module doc above) but kept as its OWN function, rather than
 * inlined at the call site, so a future encryption-at-rest change has one
 * place to make throw `SecretUnavailableError` — the exact shape
 * `POST /v1/config/secrets/reveal`'s `409 SECRET_UNAVAILABLE` response
 * expects.
 */
class SecretUnavailableError extends Error {
  constructor() {
    super('secret value could not be decrypted');
    this.name = 'SecretUnavailableError';
  }
}
function decryptSecretValue(stored: unknown): string {
  // Secret-typed keys validate to `{ type: 'string' }` (src/validation/schema.ts
  // baseSchemaFor('secret')), so a well-formed store always has a string here.
  // Coerced defensively rather than assumed, so a value stored before its key
  // was ever marked `isSecret` still reveals SOMETHING rather than crashing.
  return typeof stored === 'string' ? stored : JSON.stringify(stored);
}

/**
 * In-memory sliding-window throttle, keyed per (subject, namespace, key,
 * scope) — deliberately narrower than a per-caller-only limit, so hammering
 * one credential is caught without also rate-limiting every OTHER secret the
 * same operator is entitled to reveal in the same window.
 *
 * DOCUMENTED LIMITATION (same "best-effort, not silently assumed" discipline
 * as src/services/scope-chain.ts's own chain-assembly gap): this state is
 * per-process. A config-service deployment with more than one replica does
 * not share this window, so the effective limit is `maxAttempts` PER POD,
 * not per deployment. Closing that requires a shared store (Redis, or the
 * Security API growing a rate-limit primitve of its own) this service does
 * not have a dependency on today. Real throttling within one process is
 * still strictly better than the alternative of not throttling at all.
 */
export class RevealRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts = 5,
    private readonly windowMs = 60_000,
  ) {}

  /** Records one attempt and returns whether it is within the allowed window. */
  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.maxAttempts) {
      this.attempts.set(key, recent);
      return false;
    }
    recent.push(now);
    this.attempts.set(key, recent);
    return true;
  }
}

export function createSecretsWriteRouter(pool: Pool, rateLimiter: RevealRateLimiter = new RevealRateLimiter()): Router {
  const namespaces = new PgNamespaceRepository(pool);
  const keyDefs = new PgKeyDefinitionRepository(pool);
  const values = new PgValueRepository(pool);
  const history = new PgHistoryRepository(pool);

  const router = Router();

  router.post('/v1/config/secrets/reveal', requireAuth, async (req: Request, res: Response) => {
    // Express 4 does not catch a rejected promise from an async handler —
    // an uncaught throw here would hang the request forever rather than
    // 500ing (no response, ever). Wrapping the whole body is the same
    // "recoverable failure gets a real response" discipline the write
    // surface's own transaction step already applies (config.write.ts);
    // reveal has no transaction step to hang the catch off of, so it wraps
    // the whole handler instead.
    try {
      await handleReveal(req, res);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[config-service] reveal failed', err);
      res.status(500).json({ error: 'internal_error', message: 'Unexpected failure handling the reveal request.' });
    }
  });

  async function handleReveal(req: Request, res: Response): Promise<void> {
    const principal = req.principal!;

    // ── 1. Structural shape (400). ──────────────────────────────────────────
    const shape = validateRevealSecretRequestShape(req.body);
    if (!shape.valid) {
      sendError(res, 400, {
        code: 'VALIDATION_ERROR',
        message: 'Malformed reveal request.',
        details: shape.errors.map((m) => ({ message: m })),
      });
      return;
    }
    const body = req.body as RevealSecretRequestInput;

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

    // ── 2. Authorization (403), BEFORE any existence check. ─────────────────
    // Matches GET /v1/config's own ordering discipline (config-read.routes.ts):
    // a caller with no 'reveal' grant learns nothing about whether the
    // namespace/key/scope exists, or whether a secret is even stored there.
    // 'reveal' is its OWN action, decided independently of 'read'/'write' —
    // never derived from them, and never satisfied merely by the caller
    // having supplied the right namespace/scope/key (openapi.yaml: "an
    // operator who may Replace a credential does not automatically get to
    // Reveal it"; CLAUDE.md: an id — or an address built from ids — is never
    // a capability). The Security API decides 'reveal' on its own policy, the
    // same way it decides every other action this service checks.
    const resourceKey = `${body.namespace}:${body.scope.scopeType}:${body.scope.scopeId ?? 'platform'}`;
    const allowed = await checkAuthorization(req, CONFIG_SCOPE_RESOURCE, 'reveal', resourceKey, deriveTenant(body.scope, req));
    if (!allowed) {
      sendError(res, 403, { code: 'FORBIDDEN', message: 'No reveal grant over the requested scope.' });
      return;
    }

    // ── 3. Namespace + key existence (404). ──────────────────────────────────
    const namespace = await namespaces.findByName(body.namespace);
    if (!namespace) {
      sendError(res, 404, { code: 'NOT_FOUND', message: `no such namespace '${body.namespace}'` });
      return;
    }
    const definitions = await keyDefs.listByNamespace(namespace.id);
    const definition = definitions.find((d) => d.key === body.key);
    // Hidden keys 404 — the SAME masking rule every other lookup in this
    // service applies (config-read.routes.ts `getKeyDefinition`/GET /v1/config):
    // this endpoint never confirms a hidden key's existence either.
    if (!definition || definition.isHidden) {
      sendError(res, 404, { code: 'NOT_FOUND', message: `no such key '${body.key}' in namespace '${body.namespace}'` });
      return;
    }
    if (!definition.isSecret) {
      // Not one of openapi.yaml's named reveal error cases (404/409/429):
      // revealing a NON-secret key is a malformed request against a real,
      // existing key — VALIDATION_ERROR, not "not found" (which would read
      // as "no such key exists" when the key plainly does).
      sendError(res, 400, {
        code: 'VALIDATION_ERROR',
        message: `key '${body.key}' is not isSecret; nothing to reveal.`,
        details: [{ key: body.key, message: 'key.isSecret is false' }],
      });
      return;
    }

    // ── 4. Throttle (429), keyed per (subject, namespace, scope, key). ──────
    // Runs only once the target secret is confirmed to exist — matches the
    // "every attempt against a REAL secret" scope of the history write below;
    // an attempt against a namespace/key that does not exist never reaches
    // (or drains) this window.
    const rateLimitKey = `${principal.userId}:${resourceKey}:${body.key}`;
    if (!rateLimiter.allow(rateLimitKey)) {
      await recordReveal(history, { definitionId: definition.id, namespace: body.namespace, key: body.key, scope: body.scope, actorId: principal.userId, reason: body.reason });
      sendError(res, 429, {
        code: 'RATE_LIMITED',
        message: 'Too many reveal attempts for this credential. Try again later.',
      });
      return;
    }

    // ── 5. The stored value at the EXACT target scope (404 if isSet: false). ─
    const rows = await values.listForDefinitions([definition.id], [body.scope]);
    const stored = rows[0];
    if (!stored) {
      await recordReveal(history, { definitionId: definition.id, namespace: body.namespace, key: body.key, scope: body.scope, actorId: principal.userId, reason: body.reason });
      sendError(res, 404, {
        code: 'NOT_FOUND',
        message: `no value is currently stored for key '${body.key}' at this exact scope`,
      });
      return;
    }

    // ── 6. Decrypt (409 SECRET_UNAVAILABLE on failure — see module doc). ────
    let plaintext: string;
    try {
      plaintext = decryptSecretValue(stored.value);
    } catch (err) {
      if (err instanceof SecretUnavailableError) {
        await recordReveal(history, { definitionId: definition.id, namespace: body.namespace, key: body.key, scope: body.scope, actorId: principal.userId, reason: body.reason });
        sendError(res, 409, {
          code: 'SECRET_UNAVAILABLE',
          message: 'This secret cannot be decrypted right now. The value has not been deleted.',
        });
        return;
      }
      throw err;
    }

    // ── 7. Success — audit, then respond. Never cached, never re-servable. ──
    const entry = await recordReveal(history, {
      definitionId: definition.id,
      namespace: body.namespace,
      key: body.key,
      scope: body.scope,
      actorId: principal.userId,
      reason: body.reason,
    });

    res.status(200).setHeader('Cache-Control', 'no-store').json({
      namespace: body.namespace,
      scope: body.scope,
      key: body.key,
      value: plaintext,
      revealedAt: entry.occurredAt,
      historyEntryId: entry.id,
    });
  }

  return router;
}

/**
 * Every reveal attempt against a resolved secret — success or not — writes
 * its own `reveal` entry (openapi.yaml: "every call — success or not —
 * writes its own reveal entry ... against the caller"). `oldValue`/`newValue`
 * are never populated for `reveal` (it never changes the resolved value) and
 * `redacted` is always true here (only an `isSecret` key ever reaches this
 * call, by construction — step 3 above refuses any other key before this
 * point).
 */
function recordReveal(
  history: PgHistoryRepository,
  args: { definitionId: import('../types').KeyDefinitionEntityId; namespace: string; key: string; scope: Scope; actorId: string; reason: string },
) {
  return history.append({
    definitionId: args.definitionId,
    namespace: args.namespace,
    key: args.key,
    scope: args.scope,
    action: 'reveal',
    redacted: true,
    actor: { actorType: 'user', actorId: args.actorId },
    reason: args.reason,
  });
}
