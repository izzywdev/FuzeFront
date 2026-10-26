import { z } from 'zod';
/**
 * How the pack related to what was already applied for (org, source, packKey):
 *   applied          first time this pack was applied to the org
 *   upgraded         a higher version was applied over a lower one
 *   already-applied  this exact version was already applied — no changes (duplicate / re-send)
 *   superseded       a HIGHER version is already applied — no changes (late / out-of-order request)
 */
export declare const SELECTION_LIST_SEED_OUTCOMES: readonly ["applied", "upgraded", "already-applied", "superseded"];
/**
 * Per-list result. `skipped-user-edited` / `skipped-user-deleted` are the
 * "never overwrite the user" rule made visible: the list (or every item in it)
 * was changed or removed by a human after seeding, so seeding left it alone.
 */
export declare const SELECTION_LIST_SEED_LIST_ACTIONS: readonly ["created", "updated", "unchanged", "archived", "skipped-user-edited", "skipped-user-deleted"];
/**
 * `selection-lists.seed.completed` — a seed request (or a platform default seed
 * triggered by `identity.org.created`) was processed successfully. The whole
 * request was applied atomically; there is no partial success.
 */
export declare const selectionListsSeedCompletedSchemaV1: any;
export type SelectionListsSeedCompletedPayloadV1 = z.infer<typeof selectionListsSeedCompletedSchemaV1>;
