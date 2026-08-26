import { z } from 'zod';
/**
 * Emitted when an organization's mutable fields (name, slug, settings,
 * metadata) change. Carries the full post-update snapshot so consumers can
 * re-seed idempotently — see `organizationSnapshotV1`.
 */
export declare const identityOrgUpdatedSchemaV1: z.ZodObject<{
    organizationId: z.ZodString;
    slug: z.ZodString;
    name: z.ZodString;
    type: z.ZodEnum<["platform", "organization", "personal"]>;
    parentId: z.ZodNullable<z.ZodString>;
    ownerId: z.ZodNullable<z.ZodString>;
    isActive: z.ZodBoolean;
    settings: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, "strip", z.ZodTypeAny, {
    slug: string;
    name: string;
    type: "organization" | "platform" | "personal";
    organizationId: string;
    parentId: string | null;
    ownerId: string | null;
    isActive: boolean;
    settings?: Record<string, any> | undefined;
    metadata?: Record<string, any> | undefined;
}, {
    slug: string;
    name: string;
    type: "organization" | "platform" | "personal";
    organizationId: string;
    parentId: string | null;
    ownerId: string | null;
    isActive: boolean;
    settings?: Record<string, any> | undefined;
    metadata?: Record<string, any> | undefined;
}>;
export type IdentityOrgUpdatedPayloadV1 = z.infer<typeof identityOrgUpdatedSchemaV1>;
