import { z } from 'zod';
/**
 * Emitted when an organization is deleted. Thin payload: consumers tear their
 * own per-org state down from the id. `cascade` distinguishes a soft delete
 * (deactivation — `organizations.is_active = false`, the current behaviour) from
 * a hard delete (row removed); consumers deactivate vs. purge accordingly.
 */
export declare const identityOrgDeletedSchemaV1: z.ZodObject<{
    organizationId: z.ZodString;
    slug: z.ZodString;
    ownerId: z.ZodNullable<z.ZodString>;
    cascade: z.ZodEnum<["soft", "hard"]>;
}, "strip", z.ZodTypeAny, {
    slug: string;
    organizationId: string;
    cascade: "soft" | "hard";
    ownerId: string | null;
}, {
    slug: string;
    organizationId: string;
    cascade: "soft" | "hard";
    ownerId: string | null;
}>;
export type IdentityOrgDeletedPayloadV1 = z.infer<typeof identityOrgDeletedSchemaV1>;
