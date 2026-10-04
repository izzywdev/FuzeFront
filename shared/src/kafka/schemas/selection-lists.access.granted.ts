import { z } from 'zod';
import {
  slActorV1,
  slEventIdV1,
  slListIdV1,
  slListKeyV1,
  slOrganizationIdV1,
  slRoleV1,
  slUserIdV1,
} from './selection-lists.common';

/**
 * `selection-lists.access.granted` — a user now holds `role` on one list
 * instance (written to the Security API first, then mirrored). A role CHANGE
 * is a grant with `previousRole` set. Informational only: authorization stays
 * with the Security API / Permit — never authorize from this event.
 */
export const selectionListsAccessGrantedSchemaV1 = z.object({
  eventId: slEventIdV1,
  organizationId: slOrganizationIdV1,
  actor: slActorV1,
  listId: slListIdV1,
  listKey: slListKeyV1,
  /** The grantee. */
  userId: slUserIdV1,
  role: slRoleV1,
  previousRole: slRoleV1.nullable(),
});

export type SelectionListsAccessGrantedPayloadV1 = z.infer<typeof selectionListsAccessGrantedSchemaV1>;
