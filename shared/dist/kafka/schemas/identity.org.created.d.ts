import { z } from 'zod';
/**
 * Snapshot of an organization carried by the created/updated lifecycle events
 * (event-carried state transfer): a consumer can seed its own per-org state
 * from the event alone, without calling back to the source service.
 *
 * `ownerId` / `parentId` are nullable because the seeded root/platform org has
 * no owner and no parent.  Arbitrary `settings` and `metadata` are deliberately
 * excluded: they are not an event contract, may contain tenant-private values,
 * and must be read through FuzeFront's authorized API when needed.
 */
export declare const organizationSnapshotV1: z.ZodObject<{
    organizationId: z.ZodString;
    slug: z.ZodString;
    name: z.ZodString;
    type: z.ZodEnum<["platform", "organization", "personal"]>;
    parentId: z.ZodNullable<z.ZodString>;
    ownerId: z.ZodNullable<z.ZodString>;
    isActive: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    type: "organization" | "platform" | "personal";
    slug: string;
    name: string;
    organizationId: string;
    parentId: string | null;
    ownerId: string | null;
    isActive: boolean;
}, {
    type: "organization" | "platform" | "personal";
    slug: string;
    name: string;
    organizationId: string;
    parentId: string | null;
    ownerId: string | null;
    isActive: boolean;
}>;
export declare const identityOrgCreatedSchemaV1: z.ZodObject<{
    organizationId: z.ZodString;
    slug: z.ZodString;
    name: z.ZodString;
    type: z.ZodEnum<["platform", "organization", "personal"]>;
    parentId: z.ZodNullable<z.ZodString>;
    ownerId: z.ZodNullable<z.ZodString>;
    isActive: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    type: "organization" | "platform" | "personal";
    slug: string;
    name: string;
    organizationId: string;
    parentId: string | null;
    ownerId: string | null;
    isActive: boolean;
}, {
    type: "organization" | "platform" | "personal";
    slug: string;
    name: string;
    organizationId: string;
    parentId: string | null;
    ownerId: string | null;
    isActive: boolean;
}>;
export type IdentityOrgCreatedPayloadV1 = z.infer<typeof identityOrgCreatedSchemaV1>;
