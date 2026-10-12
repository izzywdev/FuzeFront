import { z } from 'zod';
/**
 * A small, tenant-scoped authorization invalidation signal.
 *
 * It deliberately carries neither Permit/OPAL policy source nor a permission
 * set. Those are security-sensitive implementation details and consumers must
 * obtain an allowed subject's current grants through FuzeFront instead.  The
 * event's sole purpose is to let an authorized consumer invalidate materialized
 * access decisions after a membership/role change.
 */
export declare const identityAuthorizationChangedSchemaV1: z.ZodObject<{
    organizationId: z.ZodString;
    subjectId: z.ZodString;
    change: z.ZodEnum<["membership_added", "membership_removed", "membership_role_changed"]>;
    /** The post-change role when one exists; omitted after removal. */
    role: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    subjectId: string;
    change: "membership_added" | "membership_removed" | "membership_role_changed";
    role?: string | undefined;
}, {
    organizationId: string;
    subjectId: string;
    change: "membership_added" | "membership_removed" | "membership_role_changed";
    role?: string | undefined;
}>;
export type IdentityAuthorizationChangedPayloadV1 = z.infer<typeof identityAuthorizationChangedSchemaV1>;
