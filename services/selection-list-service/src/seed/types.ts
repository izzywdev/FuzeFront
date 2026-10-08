// seed/types.ts - the typed surface of the seed library.

import type {
  SelectionListSeedListSpecV1,
  SelectionListsSeedCompletedPayloadV1,
  SelectionListsSeedFailedPayloadV1,
} from '@fuzefront/shared/kafka';

/** `created_by` / audit `actor_id` of every seeded row (plan section 9.2). */
export const SEED_PRINCIPAL = 'system:selection-list-service';

export type SeedFailureReason = SelectionListsSeedFailedPayloadV1['reason'];
export type SeedFailureDetail = SelectionListsSeedFailedPayloadV1['details'][number];
export type SeedListResult = SelectionListsSeedCompletedPayloadV1['lists'][number];
export type SeedOutcome = SelectionListsSeedCompletedPayloadV1['outcome'];
export type SeedTrigger = SelectionListsSeedCompletedPayloadV1['trigger'];

/** Default `retryable` per failure reason (plan section 8 / the seed.failed schema). */
export const SEED_FAILURE_RETRYABLE: Record<SeedFailureReason, boolean> = {
  SCOPE_UNSUPPORTED: false,
  SEEDING_DISABLED: true,
  ATTESTATION_INVALID: true,
  SOURCE_NOT_ALLOWED: false,
  NAMESPACE_VIOLATION: false,
  LIMIT_EXCEEDED: false,
  QUOTA_EXCEEDED: true,
  KEY_CONFLICT: true,
  PACK_CONTENT_MISMATCH: false,
  ORG_UNKNOWN: true,
  ORG_INACTIVE: false,
  VALIDATION_ERROR: false,
  INTERNAL_ERROR: true,
};

/** A domain-level refusal: nothing was written; the library turns it into `seed.failed`. */
export class SeedFailure extends Error {
  readonly retryable: boolean;
  constructor(
    readonly reason: SeedFailureReason,
    message: string,
    readonly details: SeedFailureDetail[] = [],
    retryable?: boolean,
  ) {
    super(message);
    this.name = 'SeedFailure';
    this.retryable = retryable ?? SEED_FAILURE_RETRYABLE[reason];
  }
}

/**
 * One seed request, as the library understands it. Both consumers build this: the
 * `seed.requested` handler from the parsed message + the introspected token subject,
 * the `identity.org.created` handler / reconciler via `applyPlatformDefaults`.
 */
export interface SeedApplyRequest {
  /** Org in any stored form (`org_...` TypeID or bare UUID); rendered to the wire TypeID. */
  organizationId: string;
  /** Anything but 'org' is answered SCOPE_UNSUPPORTED (decision section 2, open question Q1). */
  scope: 'org' | 'user';
  userId?: string;
  /** `source.app` is the seed source / allowlist key; `platform` is the service's own packs. */
  source: { app: string; service: string };
  pack: { key: string; version: number };
  trigger: SeedTrigger;
  /** Echoed on the outcome event; null for platform seeds not triggered by a request. */
  requestId: string | null;
  lists: SelectionListSeedListSpecV1[];
  /**
   * Who wrote the non-source translations in `lists`. 'human' (default, and always the case for
   * `seed.requested`): written with `is_machine = false`. 'machine': the pack's translations are
   * machine/AI output with no native review - written with `is_machine = true`, kept out of the
   * "was this edited by a human" hash, and replaced by reviewed text when a later pack version
   * ships it. Only platform packs can say 'machine' (platform.ts); the Kafka contract has no such field.
   */
  translationProvenance?: 'human' | 'machine';
  /**
   * The introspected token `subject` (plan section 8), set by the consumer AFTER it
   * verified the attestation (active, scope `selection-lists:seed`). Required for an
   * app source (missing = ATTESTATION_INVALID); ignored for `platform`. The token
   * itself never enters the library, an event, or a log.
   */
  attestedSubject?: string | null;
  /** Envelope correlation id for every event this request writes (defaults to the current request id / event id). */
  correlationId?: string;
  /**
   * 'projection' (default): the org must be known and active in the org projection
   * (`selection_list_ref_index`) - ORG_UNKNOWN / ORG_INACTIVE otherwise.
   * 'skip': no projection check (for callers that already established it).
   */
  orgCheck?: 'projection' | 'skip';
  /**
   * What to do with an UNEXPECTED error (a bug / database fault, after transient
   * retries): 'record' (default) rolls back, writes `seed.failed` / INTERNAL_ERROR
   * (retryable) in its own transaction and returns it; 'throw' rethrows so the
   * consumer's own retry/backoff applies (it can call `recordSeedFailure` when its
   * retries are exhausted).
   */
  internalErrors?: 'record' | 'throw';
}

export interface SeedCompleted {
  status: 'completed';
  outcome: SeedOutcome;
  /** Highest applied version of the pack after processing. */
  appliedVersion: number;
  lists: SeedListResult[];
  /** The `seed.completed` event's id (its outbox row id). */
  eventId: string;
  organizationId: string;
}

export interface SeedFailed {
  status: 'failed';
  reason: SeedFailureReason;
  message: string;
  retryable: boolean;
  details: SeedFailureDetail[];
  /** The `seed.failed` event's id (its outbox row id). */
  eventId: string;
  organizationId: string;
}

export type SeedResult = SeedCompleted | SeedFailed;
