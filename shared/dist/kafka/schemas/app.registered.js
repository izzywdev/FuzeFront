"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appRegisteredSchemaV1 = void 0;
const zod_1 = require("zod");
/**
 * Emitted when an app is registered in the app registry.
 * Durable, cross-service successor to the legacy Socket.io `app-registered` emit.
 */
exports.appRegisteredSchemaV1 = zod_1.z.object({
    slug: zod_1.z.string(),
    name: zod_1.z.string(),
    mode: zod_1.z.enum(['portal', 'standalone']),
    integrationType: zod_1.z.enum(['module-federation', 'iframe', 'web-component', 'spa']),
    builtin: zod_1.z.boolean(),
    organizationId: zod_1.z.string().uuid().nullable().optional(),
    /** ISO-8601 registration timestamp */
    registeredAt: zod_1.z.string().datetime(),
});
