/**
 * Delivering identity org lifecycle events to the service under test, the way the existing suites do it.
 *
 * The three consumers (`identity.org.created` / `.updated` / `.deleted`) are Kafka consumers, and CI runs the service
 * WITHOUT a broker (see helpers/seed-harness.ts, contract/seeding.test.ts). The only Kafka-free entry points are the
 * compiled handlers the consumers call (`dist/events/*.handler.js`); they are driven here against the SAME Postgres the
 * running service instances use, and the HTTP-visible half of every effect (writes refused, reads served, lists purged)
 * is observed through those instances. This module adds no second delivery mechanism: it is the seeding suite's, with the
 * envelope shape of the frozen identity schemas (`identityOrg{Created,Updated,Deleted}SchemaV1`).
 *
 * What is real: Postgres + migrations, the handlers, the projection (`selection_list_ref_index`), the org lock and the
 * suspension state the service instances read FRESH on every request. What is not exercised: the Kafka transport and the
 * TypedConsumer's schema validation / DLQ (covered by the service's own events.consumer tests).
 *
 * `occurredAt` is explicit everywhere: the suspend/resume state machine is ORDERED by the envelope's original time, so a
 * test that cares about ordering names the instants (`at`) rather than hoping the wall clock ticks between two calls.
 */
import { db as serviceDb } from '../../../services/selection-list-service/dist/db';
import { handleOrgCreated } from '../../../services/selection-list-service/dist/events/org-created.handler';
import { handleOrgDeleted } from '../../../services/selection-list-service/dist/events/org-deleted.handler';
import { handleOrgUpdated } from '../../../services/selection-list-service/dist/events/org-updated.handler';
import { canonicalUuid } from './ids';

export type OrgType = 'platform' | 'organization' | 'personal';

export interface OrgSnapshotOverrides {
  type?: OrgType;
  isActive?: boolean;
  name?: string;
}

const snapshot = (orgWire: string, over: OrgSnapshotOverrides) => ({
  organizationId: canonicalUuid(orgWire), // identity events carry the bare UUID
  slug: `org-${canonicalUuid(orgWire).slice(-6)}`,
  name: over.name ?? 'Test org',
  type: over.type ?? 'organization',
  isActive: over.isActive ?? true,
  parentId: null,
  ownerId: null,
});

const envelope = (topic: string, payload: unknown, at: string, correlationId: string) =>
  ({ version: '1.0', topic, correlationId, occurredAt: at, payload }) as never;

/** `identity.org.created`. Seeding is switched OFF for the delivery (the projection is what is under test). */
export const deliverOrgCreated = (orgWire: string, at: string, correlationId: string, over: OrgSnapshotOverrides = {}) =>
  handleOrgCreated(envelope('identity.org.created', snapshot(orgWire, over), at, correlationId), { isSeedingEnabled: async () => false });

/** `identity.org.updated` (the full post-update snapshot). */
export const deliverOrgUpdated = (orgWire: string, at: string, correlationId: string, over: OrgSnapshotOverrides = {}) =>
  handleOrgUpdated(envelope('identity.org.updated', snapshot(orgWire, over), at, correlationId));

/** `identity.org.deleted` with the given cascade. */
export const deliverOrgDeleted = (orgWire: string, at: string, correlationId: string, cascade: 'soft' | 'hard' = 'soft') =>
  handleOrgDeleted(
    envelope('identity.org.deleted', { organizationId: canonicalUuid(orgWire), slug: 'x', ownerId: null, cascade }, at, correlationId),
  );

/** The service's own knex pool the handlers use; a suite that delivers events destroys it in `afterAll`. */
export const closeEventDb = (): Promise<void> => serviceDb.destroy();
