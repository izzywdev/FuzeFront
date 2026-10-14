// events/org-created.handler.ts - `identity.org.created` -> org projection + platform defaults
// (plan section 7.1).
//
// 1. Project the org (`selection_list_ref_index`): ALWAYS, whatever the flag says, so later
//    `seed.requested` messages and the reconciler can see the org exist. Idempotent, and a
//    tombstone left by an earlier `identity.org.deleted` is never resurrected.
// 2. `isActive === false` -> no seeding (no ledger row), logged.
// 3. Seeding flag OFF for the org -> no seeding, logged; the reconciler backfills when the
//    flag turns ON (the flag is read per message, here, never inside the seed library).
// 4. Otherwise `applyPlatformDefaults(..., { trigger: 'org-created' })`: the packs whose
//    `appliesTo` includes the org's type (personal / platform rules live in the pack), one
//    transaction per pack, `seed.completed` / `seed.failed` via the outbox.
//
// Failure model. A BUSINESS refusal (ORG_INACTIVE for a deleted org, quota, ...) never throws:
// the library records `seed.failed` and the handler returns, so the offset commits. Only a
// transient infrastructure fault throws (the TypedConsumer / kafkajs retries the message), and
// redelivery is safe: the ledger makes the apply a no-op once it has succeeded
// (`already-applied`, no new rows). A bounded per-message budget turns a fault that never heals
// into a recorded `seed.failed` / INTERNAL_ERROR (retryable) instead of a wedged partition.

import type { Knex } from 'knex';
import { FuzeEvent, IdentityOrgCreatedPayloadV1 } from '@fuzefront/shared/kafka';
import { db as defaultDb } from '../db';
import { logger, timed } from '../lib/logger';
import { applyPlatformDefaults, isSeedingEnabled, type PlatformSeedOutcome } from '../seed';
import { upsertOrgProjection } from './orgProjection';
import { RetryBudget } from './retryBudget';

export interface OrgCreatedDeps {
  db: Knex;
  isSeedingEnabled: (organizationId: string) => Promise<boolean>;
  applyPlatformDefaults: typeof applyPlatformDefaults;
  budget: RetryBudget;
}

const defaultBudget = new RetryBudget();

export type OrgCreatedResult =
  | { projected: true; seeding: 'skipped-inactive' | 'skipped-flag-off' }
  | { projected: true; seeding: 'attempted'; outcomes: PlatformSeedOutcome[] };

export async function handleOrgCreated(
  event: FuzeEvent<IdentityOrgCreatedPayloadV1>,
  overrides: Partial<OrgCreatedDeps> = {},
): Promise<OrgCreatedResult> {
  const deps: OrgCreatedDeps = {
    db: defaultDb,
    isSeedingEnabled,
    applyPlatformDefaults,
    budget: defaultBudget,
    ...overrides,
  };
  const { organizationId, type, isActive, ownerId, name } = event.payload;
  const log = logger.child({ reqId: event.correlationId, component: 'org-created' });
  log.info({ organizationId, type, isActive }, 'identity.org.created received');

  // 1. Projection first, unconditionally (infra faults throw -> retried).
  const wire = await timed(log, 'db.upsert-org-projection', () => upsertOrgProjection(deps.db, { organizationId, type, isActive, ownerId, name, occurredAt: event.occurredAt }), { organizationId });

  // 2. Inactive orgs are not seeded.
  if (!isActive) {
    log.info({ organizationId: wire }, 'org is inactive: projected, platform defaults skipped');
    return { projected: true, seeding: 'skipped-inactive' };
  }

  // 3. Flag, evaluated per message for this org (fail closed -> false).
  if (!(await deps.isSeedingEnabled(wire))) {
    log.info({ organizationId: wire }, 'seeding flag is OFF for this org: projected, platform defaults not applied (the reconciler backfills once it is ON)');
    return { projected: true, seeding: 'skipped-flag-off' };
  }

  // 4. Seed. 'throw' makes a transient fault retryable; the last attempt records instead.
  const budgetKey = `org-created:${wire}:${event.correlationId}`;
  const { attempt, last } = deps.budget.next(budgetKey);
  try {
    const outcomes = await timed(
      log,
      'seed.apply-platform-defaults',
      () =>
        deps.applyPlatformDefaults(deps.db, wire, {
          trigger: 'org-created',
          correlationId: event.correlationId,
          internalErrors: last ? 'record' : 'throw',
        }),
      { organizationId: wire, attempt },
    );
    deps.budget.clear(budgetKey);
    for (const o of outcomes) {
      if (o.result?.status === 'failed') {
        log.warn({ organizationId: wire, pack: o.packKey, reason: o.result.reason, retryable: o.result.retryable }, 'platform seeding refused (seed.failed recorded)');
      }
    }
    return { projected: true, seeding: 'attempted', outcomes };
  } catch (err) {
    log.warn({ err, organizationId: wire, attempt, willRetry: !last }, 'platform seeding hit a transient fault; the message will be retried');
    throw err;
  }
}
