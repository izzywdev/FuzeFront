import { z } from 'zod';

export const identityUserCreatedSchemaV1 = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  /** Why the user was created: initial sign-up or org invitation */
  intent: z.enum(['signup', 'org-invite']),
});

export type IdentityUserCreatedPayloadV1 = z.infer<typeof identityUserCreatedSchemaV1>;
