import { z } from 'zod';
/**
 * Snapshot of an organization carried by the created/updated lifecycle events
 * (event-carried state transfer): a consumer can seed its own per-org state
 * from the event alone, without calling back to the source service.
 *
 * `ownerId` / `parentId` are nullable because the seeded root/platform org has
 * no owner and no parent.
 */
export declare const organizationSnapshotV1: z.ZodObject<{
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
export declare const identityOrgCreatedSchemaV1: z.ZodObject<{
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
export type IdentityOrgCreatedPayloadV1 = z.infer<typeof identityOrgCreatedSchemaV1>;
