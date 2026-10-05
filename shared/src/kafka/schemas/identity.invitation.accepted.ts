import { z } from 'zod';
import {
  invitationMemberTypeV1,
  invitationRoleV1,
} from './identity.invitation.created';

/**
 * Org invitations v2 (FFRNT-305). Emitted when an invitation is accepted and the
 * membership is bound — whether the invitee was an existing account-holder or an
 * external identity that signed up and auto-bound via the bindToken. Carries the
 * `memberType` so authorization/billing consumers record how the new member
 * relates to the org (employee|customer), orthogonal to the access role.
 *
 * Ids are the storage-native uuids (consistent with the other identity.* events).
 */
export const identityInvitationAcceptedSchemaV1 = z.object({
  organizationId: z.string().uuid(),
  invitationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: invitationRoleV1,
  memberType: invitationMemberTypeV1,
});

export type IdentityInvitationAcceptedPayloadV1 = z.infer<
  typeof identityInvitationAcceptedSchemaV1
>;
