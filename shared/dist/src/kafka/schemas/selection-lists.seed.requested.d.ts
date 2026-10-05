import { z } from 'zod';
/**
 * `selection-lists.seed.requested` — INBOUND. Another service asks the
 * selection-list-service to seed a versioned pack of lists for its app into an
 * organization. This is the ONE selection-lists topic the service consumes
 * rather than produces; every other `selection-lists.*` topic is produced only
 * by selection-list-service.
 *
 * The request is a create-shaped body, so it follows the identifier standard:
 * no `id` anywhere (lists and items are minted by the service) and every
 * object is `.strict()` so an unknown field — including a smuggled `id` — is a
 * validation failure, not a silently-dropped key.
 *
 * Trust: the topic itself is not authenticated today (FuzeInfra Kafka has no
 * SASL/ACLs), so the request carries an `attestation` — a short-lived service
 * token with scope `selection-lists:seed`, introspected by the consumer and
 * matched against the `seed_sources` allowlist for `source.app`. See
 * docs/planning/selection-lists-events.md §"Trust model".
 *
 * Outcome: exactly one `selection-lists.seed.completed` or
 * `selection-lists.seed.failed` per processed request, echoing `requestId`.
 */
export declare const selectionListsSeedRequestedSchemaV1: any;
export type SelectionListsSeedRequestedPayloadV1 = z.infer<typeof selectionListsSeedRequestedSchemaV1>;
