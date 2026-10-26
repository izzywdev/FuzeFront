"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityOrgCreatedSchemaV1 = exports.organizationSnapshotV1 = void 0;
const zod_1 = require("zod");
/**
 * Snapshot of an organization carried by the created/updated lifecycle events
 * (event-carried state transfer): a consumer can seed its own per-org state
 * from the event alone, without calling back to the source service.
 *
 * `ownerId` / `parentId` are nullable because the seeded root/platform org has
 * no owner and no parent.
 */
exports.organizationSnapshotV1 = zod_1.z.object({
    organizationId: zod_1.z.string().uuid(),
    slug: zod_1.z.string(),
    name: zod_1.z.string(),
    type: zod_1.z.enum(['platform', 'organization', 'personal']),
    parentId: zod_1.z.string().uuid().nullable(),
    ownerId: zod_1.z.string().uuid().nullable(),
    isActive: zod_1.z.boolean(),
    settings: zod_1.z.record(zod_1.z.any()).optional(),
    metadata: zod_1.z.record(zod_1.z.any()).optional(),
});
exports.identityOrgCreatedSchemaV1 = exports.organizationSnapshotV1;
