import { z } from 'zod';
/**
 * `selection-lists.access.granted` — a user now holds `role` on one list
 * instance (written to the Security API first, then mirrored). A role CHANGE
 * is a grant with `previousRole` set. Informational only: authorization stays
 * with the Security API / Permit — never authorize from this event.
 */
export declare const selectionListsAccessGrantedSchemaV1: any;
export type SelectionListsAccessGrantedPayloadV1 = z.infer<typeof selectionListsAccessGrantedSchemaV1>;
