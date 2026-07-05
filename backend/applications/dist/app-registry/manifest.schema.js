"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.heartbeatRequestSchema = exports.registerAppRequestSchema = exports.appManifestSchema = exports.infraSchema = exports.routingSchema = exports.chromeSchema = exports.menuItemSchema = exports.integrationSchema = exports.iconSchema = exports.visibilitySchema = exports.integrationTypeSchema = exports.appStatusSchema = exports.appModeSchema = exports.slugSchema = void 0;
exports.toValidationErrorBody = toValidationErrorBody;
const zod_1 = require("zod");
// Zod mirror of components.schemas.AppManifest from the FROZEN contract
// (services/app-registry-service/openapi.yaml). A JSON-Schema copy
// (services/app-registry-service/manifest.schema.json) does NOT exist yet, so we
// validate against the required fields + constraints declared in the OpenAPI doc.
// Keep this in lock-step with the contract — drift here is a contract violation,
// not a local fix.
exports.slugSchema = zod_1.z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, 'must be a url-safe slug');
exports.appModeSchema = zod_1.z.enum(['portal', 'standalone']);
exports.appStatusSchema = zod_1.z.enum(['registered', 'activated', 'suspended']);
exports.integrationTypeSchema = zod_1.z.enum([
    'module-federation',
    'iframe',
    'web-component',
    'spa',
]);
exports.visibilitySchema = zod_1.z.enum([
    'private',
    'organization',
    'public',
    'marketplace',
]);
exports.iconSchema = zod_1.z
    .object({
    kind: zod_1.z.enum(['emoji', 'url']),
    value: zod_1.z.string(),
})
    .strict();
exports.integrationSchema = zod_1.z
    .object({
    type: exports.integrationTypeSchema,
    remoteEntry: zod_1.z.string().url().optional(),
    scope: zod_1.z.string().optional(),
    module: zod_1.z.string().optional(),
    url: zod_1.z.string().url().optional(),
})
    .strict()
    // module-federation requires remoteEntry + scope + module (per the contract).
    .superRefine((val, ctx) => {
    if (val.type === 'module-federation') {
        for (const field of ['remoteEntry', 'scope', 'module']) {
            if (!val[field]) {
                ctx.addIssue({
                    code: zod_1.z.ZodIssueCode.custom,
                    path: [field],
                    message: `${field} is required for module-federation integrations`,
                });
            }
        }
    }
});
exports.menuItemSchema = zod_1.z
    .object({
    id: zod_1.z.string(),
    label: zod_1.z.string(),
    icon: zod_1.z.string().optional(),
    route: zod_1.z.string().optional(),
    order: zod_1.z.number().int().optional(),
})
    .strict();
exports.chromeSchema = zod_1.z
    .object({
    menu: zod_1.z.enum(['host', 'substitute']).optional(),
    topbar: zod_1.z.enum(['host', 'hidden']).optional(),
    items: zod_1.z.array(exports.menuItemSchema).optional(),
})
    .strict();
exports.routingSchema = zod_1.z
    .object({
    path: zod_1.z
        .string()
        .regex(/^\/[a-zA-Z0-9/_-]*$/)
        .optional(),
    host: zod_1.z.string().optional(),
})
    .strict();
exports.infraSchema = zod_1.z
    .object({
    auth: zod_1.z.boolean().optional(),
    billing: zod_1.z.boolean().optional(),
    api: zod_1.z.boolean().optional(),
    deployOnFuzeInfra: zod_1.z.boolean().optional(),
})
    .strict();
exports.appManifestSchema = zod_1.z
    .object({
    manifestVersion: zod_1.z.literal('1'),
    slug: exports.slugSchema,
    name: zod_1.z.string().max(120),
    menuLabel: zod_1.z.string().max(40),
    description: zod_1.z.string().max(1024).optional(),
    icon: exports.iconSchema.optional(),
    mode: exports.appModeSchema,
    builtin: zod_1.z.boolean().optional(),
    integration: exports.integrationSchema,
    chrome: exports.chromeSchema.optional(),
    routing: exports.routingSchema.optional(),
    infra: exports.infraSchema.optional(),
    visibility: exports.visibilitySchema.optional(),
    roles: zod_1.z.array(zod_1.z.string()).optional(),
})
    .strict();
exports.registerAppRequestSchema = zod_1.z
    .object({
    manifest: exports.appManifestSchema,
    organizationId: zod_1.z.string().uuid().nullable().optional(),
})
    .strict();
exports.heartbeatRequestSchema = zod_1.z
    .object({
    status: zod_1.z.enum(['online', 'degraded']).optional().default('online'),
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
})
    .strict();
/** Turns a ZodError into the contract's ValidationErrorBody shape. */
function toValidationErrorBody(err) {
    return {
        error: 'validation_error',
        message: 'Request body failed validation',
        fields: err.issues.map(issue => ({
            path: issue.path.join('.'),
            message: issue.message,
        })),
    };
}
//# sourceMappingURL=manifest.schema.js.map