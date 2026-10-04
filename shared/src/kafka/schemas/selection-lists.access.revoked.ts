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

/** `selection-lists.access.revoked` — the user no longer holds any role on the list. */
export const selectionListsAccessRevokedSchemaV1 = z.object({
  eventId: slEventIdV1,
  organizationId: slOrganizationIdV1,
  actor: slActorV1,
  listId: slListIdV1,
  listKey: slListKeyV1,
  /** The user whose grant was removed. */
  userId: slUserIdV1,
  /** The role that was revoked. */
  role: slRoleV1,
});

export type SelectionListsAccessRevokedPayloadV1 = z.infer<typeof selectionListsAccessRevokedSchemaV1>;
