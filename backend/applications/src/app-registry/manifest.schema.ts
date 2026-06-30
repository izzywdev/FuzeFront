import { z } from 'zod'

// Zod mirror of components.schemas.AppManifest from the FROZEN contract
// (services/app-registry-service/openapi.yaml). A JSON-Schema copy
// (services/app-registry-service/manifest.schema.json) does NOT exist yet, so we
// validate against the required fields + constraints declared in the OpenAPI doc.
// Keep this in lock-step with the contract — drift here is a contract violation,
// not a local fix.

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, 'must be a url-safe slug')

export const appModeSchema = z.enum(['portal', 'standalone'])
export const appStatusSchema = z.enum(['registered', 'activated', 'suspended'])
export const integrationTypeSchema = z.enum([
  'module-federation',
  'iframe',
  'web-component',
  'spa',
])
export const visibilitySchema = z.enum([
  'private',
  'organization',
  'public',
  'marketplace',
])

export const iconSchema = z
  .object({
    kind: z.enum(['emoji', 'url']),
    value: z.string(),
  })
  .strict()

export const integrationSchema = z
  .object({
    type: integrationTypeSchema,
    remoteEntry: z.string().url().optional(),
    scope: z.string().optional(),
    module: z.string().optional(),
    url: z.string().url().optional(),
  })
  .strict()
  // module-federation requires remoteEntry + scope + module (per the contract).
  .superRefine((val, ctx) => {
    if (val.type === 'module-federation') {
      for (const field of ['remoteEntry', 'scope', 'module'] as const) {
        if (!val[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required for module-federation integrations`,
          })
        }
      }
    }
  })

export const menuItemSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    icon: z.string().optional(),
    route: z.string().optional(),
    order: z.number().int().optional(),
  })
  .strict()

export const chromeSchema = z
  .object({
    menu: z.enum(['host', 'substitute']).optional(),
    topbar: z.enum(['host', 'hidden']).optional(),
    items: z.array(menuItemSchema).optional(),
  })
  .strict()

export const routingSchema = z
  .object({
    path: z
      .string()
      .regex(/^\/[a-zA-Z0-9/_-]*$/)
      .optional(),
    host: z.string().optional(),
  })
  .strict()

export const infraSchema = z
  .object({
    auth: z.boolean().optional(),
    billing: z.boolean().optional(),
    api: z.boolean().optional(),
    deployOnFuzeInfra: z.boolean().optional(),
  })
  .strict()

export const appManifestSchema = z
  .object({
    manifestVersion: z.literal('1'),
    slug: slugSchema,
    name: z.string().max(120),
    menuLabel: z.string().max(40),
    description: z.string().max(1024).optional(),
    icon: iconSchema.optional(),
    mode: appModeSchema,
    builtin: z.boolean().optional(),
    integration: integrationSchema,
    chrome: chromeSchema.optional(),
    routing: routingSchema.optional(),
    infra: infraSchema.optional(),
    visibility: visibilitySchema.optional(),
    roles: z.array(z.string()).optional(),
  })
  .strict()

export type AppManifest = z.infer<typeof appManifestSchema>
export type AppMode = z.infer<typeof appModeSchema>
export type AppStatus = z.infer<typeof appStatusSchema>
export type Visibility = z.infer<typeof visibilitySchema>

export const registerAppRequestSchema = z
  .object({
    manifest: appManifestSchema,
    organizationId: z.string().uuid().nullable().optional(),
  })
  .strict()

export const heartbeatRequestSchema = z
  .object({
    status: z.enum(['online', 'degraded']).optional().default('online'),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export interface ValidationFieldError {
  path: string
  message: string
}

export interface ValidationErrorBody {
  error: 'validation_error'
  message: string
  fields: ValidationFieldError[]
}

/** Turns a ZodError into the contract's ValidationErrorBody shape. */
export function toValidationErrorBody(err: z.ZodError): ValidationErrorBody {
  return {
    error: 'validation_error',
    message: 'Request body failed validation',
    fields: err.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  }
}
