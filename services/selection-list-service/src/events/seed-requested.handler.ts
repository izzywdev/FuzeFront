// events/seed-requested.handler.ts - `selection-lists.seed.requested` -> app seeding (plan sections 7.2, 8).
//
// The consumer runs this handler with the RAW payload (the TypedConsumer schema is a passthrough),
// because a payload that is valid JSON but fails the schema deserves a best-effort
// `seed.failed` / VALIDATION_ERROR so the requester is not left waiting, in addition to the DLQ.
//
// Order (section 7.2), every step fail-closed, nothing written before the last:
//   1. schema-parse (`selectionListsSeedRequestedSchemaV1`)  -> VALIDATION_ERROR (best effort) + DLQ
//   2. scope 'user'                                          -> SCOPE_UNSUPPORTED
//   3. seeding flag OFF for the org (read per message)       -> SEEDING_DISABLED (retryable)
//   4. attestation: introspect the token, require scope
//      `selection-lists:seed`                                -> ATTESTATION_INVALID (retryable); an
//                                                              introspection outage THROWS (retried)
//   5. `applySeedRequest` with `attestedSubject`: allowlist row + subject binding
//      (SOURCE_NOT_ALLOWED), namespace, caps (LIMIT_EXCEEDED), org projection (ORG_UNKNOWN /
//      ORG_INACTIVE), ledger, quota ... then `seed.completed` / `seed.failed`.
//
// A business refusal NEVER throws (an event is recorded and the offset commits). Only transient
// infrastructure faults throw so the consumer retries; a bounded per-request budget converts a
// fault that never heals into a recorded INTERNAL_ERROR so one poison message cannot wedge the
// partition. The attestation token is a bearer secret: it is handed to the verifier and nowhere
// else - not to the logger, an event, a failure message/detail, or the DLQ copy (redacted).

import type { Knex } from 'knex';
import type { z } from 'zod';
import { FuzeEvent, selectionListsSeedRequestedSchemaV1, slOrganizationIdV1, SelectionListsSeedRequestedPayloadV1, TOPICS } from '@fuzefront/shared/kafka';
import { db as defaultDb } from '../db';
import { logger, timed } from '../lib/logger';
import {
  applySeedRequest,
  isSeedingEnabled,
  recordSeedFailure,
  SeedFailure,
  type SeedApplyRequest,
  type SeedResult,
} from '../seed';
import { wireOrgId } from './outbox';
import { AttestationUnavailableError, verifySeedAttestation, type AttestationVerdict } from './attestation';
import { RetryBudget } from './retryBudget';

export interface SeedRequestedDeps {
  db: Knex;
  isSeedingEnabled: (organizationId: string) => Promise<boolean>;
  verifyAttestation: (token: string) => Promise<AttestationVerdict>;
  /** Dead-letter the (token-redacted) envelope to `<topic>.dlq`. Absent: only logged. */
  deadLetter?: (topic: string, redactedEnvelope: unknown, reason: string) => Promise<void>;
  budget: RetryBudget;
}

const defaultBudget = new RetryBudget();

export type SeedRequestedResult =
  | { kind: 'result'; result: SeedResult }
  | { kind: 'invalid'; reason: string; failureRecorded: boolean };

const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The payload with the attestation token replaced: safe to log / dead-letter. */
export function redactSeedRequest(payload: unknown): unknown {
  if (!isObject(payload) || !isObject(payload.attestation)) return payload;
  return { ...payload, attestation: { ...payload.attestation, token: '[REDACTED]' } };
}

/**
 * Best-effort header for a payload that failed the schema: the fields `seed.failed` needs, if
 * (and only if) each is individually valid. Never reads the attestation.
 */
function extractFailureHeader(payload: unknown): Pick<SeedApplyRequest, 'organizationId' | 'scope' | 'source' | 'pack' | 'trigger' | 'requestId'> | null {
  if (!isObject(payload)) return null;
  const { requestId, organizationId, scope, source, pack, trigger } = payload;
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return null;
  if (!slOrganizationIdV1.safeParse(organizationId).success) return null;
  if (scope !== 'org' && scope !== 'user') return null;
  if (!isObject(source) || typeof source.app !== 'string' || typeof source.service !== 'string') return null;
  if (!isObject(pack) || typeof pack.key !== 'string' || typeof pack.version !== 'number') return null;
  if (typeof trigger !== 'string') return null;
  return {
    organizationId: organizationId as string,
    scope,
    source: { app: source.app, service: source.service },
    pack: { key: pack.key, version: pack.version },
    trigger: trigger as SeedApplyRequest['trigger'],
    requestId,
  };
}

/** Issue paths + messages, minus anything under `attestation` (never echo the token's neighbourhood). */
function describeIssues(error: { issues: Array<{ path: Array<string | number>; message: string }> }): { message: string; paths: string[] } {
  const safe = error.issues.filter((i) => i.path[0] !== 'attestation');
  const paths = [...new Set(safe.map((i) => i.path.join('.') || '(root)'))];
  const shown = safe.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  const attestationBad = error.issues.length > safe.length;
  const parts = [...shown];
  if (attestationBad) parts.push('attestation: invalid');
  return { message: `The seed request is invalid: ${parts.join('; ') || 'malformed payload'}`, paths };
}

export async function handleSeedRequested(
  event: FuzeEvent<unknown>,
  overrides: Partial<SeedRequestedDeps> = {},
): Promise<SeedRequestedResult> {
  const deps: SeedRequestedDeps = {
    db: defaultDb,
    isSeedingEnabled,
    verifyAttestation: verifySeedAttestation,
    budget: defaultBudget,
    ...overrides,
  };
  const correlationId = typeof event.correlationId === 'string' && CORRELATION_ID.test(event.correlationId) ? event.correlationId : undefined;
  const log = logger.child({ reqId: correlationId, component: 'seed-requested' });

  // 1. Schema.
  const parsed = selectionListsSeedRequestedSchemaV1.safeParse(event.payload);
  if (!parsed.success) {
    const { message, paths } = describeIssues((parsed as z.SafeParseError<unknown>).error);
    const header = extractFailureHeader(event.payload);
    let failureRecorded = false;
    if (header) {
      try {
        await recordSeedFailure(
          deps.db,
          { ...header, lists: [], correlationId },
          new SeedFailure('VALIDATION_ERROR', message, paths.slice(0, 50).map((p) => ({ path: p.slice(0, 256) }))),
        );
        failureRecorded = true;
      } catch (err) {
        log.warn({ err, requestId: header.requestId }, 'could not record VALIDATION_ERROR for an invalid seed request (best effort); dead-lettering only');
      }
    }
    log.warn({ paths, failureRecorded }, 'selection-lists.seed.requested failed schema validation: dead-lettered');
    if (deps.deadLetter) {
      await deps.deadLetter(TOPICS.SELECTION_LISTS_SEED_REQUESTED, { ...event, payload: redactSeedRequest(event.payload) }, message);
    }
    return { kind: 'invalid', reason: message, failureRecorded };
  }

  const p: SelectionListsSeedRequestedPayloadV1 = (parsed as z.SafeParseSuccess<SelectionListsSeedRequestedPayloadV1>).data;
  const organizationId = wireOrgId(p.organizationId);
  const base: SeedApplyRequest = {
    organizationId,
    scope: p.scope,
    ...(p.userId ? { userId: p.userId } : {}),
    source: p.source,
    pack: p.pack,
    trigger: p.trigger,
    requestId: p.requestId,
    lists: p.lists,
    correlationId,
  };
  log.info({ requestId: p.requestId, organizationId, source: p.source.app, pack: p.pack, trigger: p.trigger, scope: p.scope }, 'selection-lists.seed.requested received');

  const refuse = async (failure: SeedFailure): Promise<SeedRequestedResult> => ({
    kind: 'result',
    result: await timed(log, 'seed.record-failure', () => recordSeedFailure(deps.db, base, failure), { requestId: p.requestId, reason: failure.reason }),
  });

  // 2. Scope.
  if (p.scope === 'user') {
    return refuse(new SeedFailure('SCOPE_UNSUPPORTED', 'User-scoped seeding is not supported: selection lists are organization-scoped.'));
  }

  // 3. Flag (per message, per org; fail closed).
  if (!(await deps.isSeedingEnabled(organizationId))) {
    log.info({ requestId: p.requestId, organizationId }, 'seeding flag is OFF for this org: seed request refused (SEEDING_DISABLED)');
    return refuse(new SeedFailure('SEEDING_DISABLED', 'Seeding is not enabled for this organization.'));
  }

  const budgetKey = `seed-requested:${organizationId}:${p.source.app}:${p.requestId}`;
  const { attempt, last } = deps.budget.next(budgetKey);
  try {
    // 4. Attestation (the token is read here and passed ONLY to the verifier).
    let verdict: AttestationVerdict;
    try {
      verdict = await timed(log, 'attestation.introspect', () => deps.verifyAttestation(p.attestation.token), { requestId: p.requestId, source: p.source.app });
    } catch (err) {
      if (err instanceof AttestationUnavailableError && last) {
        log.error({ code: err.code, requestId: p.requestId, attempt }, 'attestation could not be verified and the retry budget is exhausted: recording INTERNAL_ERROR');
        deps.budget.clear(budgetKey);
        return refuse(new SeedFailure('INTERNAL_ERROR', 'The attestation could not be verified because of a temporary fault; nothing was written. Re-send the request.'));
      }
      throw err;
    }
    if (verdict.ok === false) {
      log.warn({ requestId: p.requestId, source: p.source.app, organizationId }, 'attestation refused (ATTESTATION_INVALID); nothing written');
      deps.budget.clear(budgetKey);
      return refuse(new SeedFailure('ATTESTATION_INVALID', (verdict as { ok: false; message: string }).message));
    }
    const attestedSubject = (verdict as { ok: true; subject: string }).subject;

    // 5. Apply (allowlist + subject binding + org + ledger + quota inside the library).
    const result = await timed(
      log,
      'seed.apply',
      () => applySeedRequest(deps.db, { ...base, attestedSubject, internalErrors: last ? 'record' : 'throw' }),
      { requestId: p.requestId, organizationId, source: p.source.app, attempt },
    );
    deps.budget.clear(budgetKey);
    if (result.status === 'failed') {
      log.warn({ requestId: p.requestId, organizationId, source: p.source.app, reason: result.reason, retryable: result.retryable }, 'seed request refused (seed.failed recorded)');
    } else {
      log.info({ requestId: p.requestId, organizationId, source: p.source.app, outcome: result.outcome, appliedVersion: result.appliedVersion }, 'seed request processed (seed.completed recorded)');
    }
    return { kind: 'result', result };
  } catch (err) {
    log.warn({ err, requestId: p.requestId, attempt, willRetry: !last }, 'seed request hit a transient fault; the message will be retried');
    throw err;
  }
}
