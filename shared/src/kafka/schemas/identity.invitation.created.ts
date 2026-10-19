import { z } from 'zod';

/**
 * Org invitations v2 (FFRNT-305). Emitted when an org owner/admin creates an
 * invitation. Carries enough for a notification worker to dispatch the invite
 * over the right CHANNEL (email + WhatsApp) without calling back to the security
 * service, and for authorization consumers to pre-stage the member's intended
 * role + memberType.
 *
 * Ids are the storage-native uuids (consistent with the other identity.* events,
 * e.g. identity.membership.added); the wire/API carries the prefixed TypeIDs.
 */
export const invitationMemberTypeV1 = z.enum(['employee', 'customer']);
export const invitationRoleV1 = z.enum(['admin', 'member', 'viewer']);
export const invitationChannelV1 = z.enum(['email', 'whatsapp']);

/** E.164 — '+' then 1–15 digits, first non-zero. Mirrors the OpenAPI pattern. */
const e164 = /^\+[1-9]\d{1,14}$/;

export const identityInvitationCreatedSchemaV1 = z
  .object({
    organizationId: z.string().uuid(),
    invitationId: z.string().uuid(),
    invitedByUserId: z.string().uuid(),
    role: invitationRoleV1,
    memberType: invitationMemberTypeV1,
    channel: invitationChannelV1,
    /** Present when the invitee is an EXISTING account-holder. */
    inviteeUserId: z.string().uuid().optional(),
    /** Delivery/identity contact — required to match `channel`. */
    email: z.string().email().optional(),
    phone: z.string().regex(e164).optional(),
    expiresAt: z.string().datetime(),
  })
  .refine((v) => (v.channel === 'email' ? !!v.email : true), {
    message: 'email is required when channel is "email"',
    path: ['email'],
  })
  .refine((v) => (v.channel === 'whatsapp' ? !!v.phone : true), {
    message: 'phone (E.164) is required when channel is "whatsapp"',
    path: ['phone'],
  });

export type IdentityInvitationCreatedPayloadV1 = z.infer<
  typeof identityInvitationCreatedSchemaV1
>;
