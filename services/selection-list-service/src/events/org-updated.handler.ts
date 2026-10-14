// events/org-updated.handler.ts - `identity.org.updated` -> org projection refresh.
//
// The projection (`selection_list_ref_index`) is written by `identity.org.created` (type /
// is_active / owner / name snapshot) and `identity.org.deleted` (tombstone). Without this handler
// a later deactivation (or re-activation, type change, rename) was invisible: `ORG_INACTIVE`
// never fired and the reconciler kept backfilling an org identity considers inactive.
//
// What it does: refresh `org_type`, `is_active` and `org_name` from the post-update snapshot
// (the payload is the FULL snapshot, event-carried state transfer). Properties:
//   - FLAG-INDEPENDENT: the projection is always maintained, exactly like org.created's step 1;
//     no seeding is triggered here (the reconciler picks up an org that became active again).
//   - NEVER resurrects a deleted tombstone: the upsert refreshes snapshot columns, not `status`.
//   - Ordered by the envelope `occurredAt`: a snapshot older than the newest applied one is
//     ignored (a late `org.created` cannot overwrite what this event taught the projection, and a
//     redelivered older `org.updated` cannot roll a newer one back).
//   - The owner is NOT moved: grants must not silently follow an ownership change.
//   - Idempotent (a redelivery rewrites the same values). An org this service has not seen yet is
//     inserted as projected (an `updated` is proof the org exists); `org.created` fills in the owner.
//   - A malformed payload never reaches here: TypedConsumer validates against
//     `identityOrgUpdatedSchemaV1` and dead-letters it to `identity.org.updated.dlq`. An
//     infrastructure fault throws so kafkajs retries the message.

import type { Knex } from 'knex';
import { FuzeEvent, IdentityOrgUpdatedPayloadV1 } from '@fuzefront/shared/kafka';
import { db as defaultDb } from '../db';
import { logger, timed } from '../lib/logger';
import { upsertOrgProjection } from './orgProjection';

export interface OrgUpdatedDeps {
  db: Knex;
}

export async function handleOrgUpdated(
  event: FuzeEvent<IdentityOrgUpdatedPayloadV1>,
  overrides: Partial<OrgUpdatedDeps> = {},
): Promise<{ organizationId: string }> {
  const deps: OrgUpdatedDeps = { db: defaultDb, ...overrides };
  const { organizationId, type, isActive, name } = event.payload;
  const log = logger.child({ reqId: event.correlationId, component: 'org-updated' });
  log.info({ organizationId, type, isActive }, 'identity.org.updated received');

  const wire = await timed(
    log,
    'db.upsert-org-projection',
    () => upsertOrgProjection(deps.db, { organizationId, type, isActive, name, occurredAt: event.occurredAt }),
    { organizationId },
  );
  log.info({ organizationId: wire, type, isActive }, 'org projection refreshed from identity.org.updated');
  return { organizationId: wire };
}
