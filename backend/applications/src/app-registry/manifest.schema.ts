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

// Lifecycle sections, in the order the host renders them:
// steer -> plan -> build -> sell -> serve -> measure -> operate. The ARRAY ORDER is
// the render order — `navSectionRank` below derives from it, so adding a section in
// the right position is all it takes to place it in the menu.
export const NAV_SECTIONS = [
  'executive',
  'plan',
  'build',
  'revenue',
  'customer',
  'insight',
  'platform',
] as const

export const navSectionSchema = z.enum(NAV_SECTIONS)

/** Default section for an app that declares no `nav` — sorts last. */
export const DEFAULT_NAV_SECTION: NavSection = 'platform'
/** Default rank within a section for an app that declares no order — sorts last. */
export const DEFAULT_NAV_ORDER = 999

/** 0-based render rank of a section. Unknown values sort last, never throw. */
export function navSectionRank(section: string | null | undefined): number {
  const idx = NAV_SECTIONS.indexOf(section as NavSection)
  return idx === -1 ? NAV_SECTIONS.length : idx
}

export const navSchema = z
  .object({
    section: navSectionSchema.optional(),
    order: z.number().int().min(0).max(9999).optional(),
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
    nav: navSchema.optional(),
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
export type NavSection = (typeof NAV_SECTIONS)[number]
export type Nav = z.infer<typeof navSchema>

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

// ── onboarding: ProductPolicy / BillingProfile ────────────────────────────────
// 1:1 with the ProductPolicy / BillingProfile schemas in
// services/app-registry-service/openapi.yaml. Keys are BARE here on purpose —
// the platform namespaces them by slug (`Listing` → `<slug>_Listing`) at merge
// time, so `_` is reserved as the namespace separator and rejected in keys.
const bareKeySchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9-]*$/,
    'must be a bare key ([A-Za-z][A-Za-z0-9-]*) — `_` is the namespace separator'
  )

export const productResourceDeclSchema = z
  .object({
    key: bareKeySchema,
    name: z.string(),
    actions: z.record(z.string(), z.object({ name: z.string() }).strict()),
  })
  .strict()

export const productRoleDeclSchema = z
  .object({
    key: bareKeySchema,
    name: z.string(),
    permissions: z.array(
      z
        .string()
        .regex(
          /^[A-Za-z][A-Za-z0-9-]*:[A-Za-z][A-Za-z0-9_-]*$/,
          'must be `<BareResource>:<action>`'
        )
    ),
  })
  .strict()

export const productPolicySchema = z
  .object({
    // Implied by the path slug. Accepted in the body only so a product can be
    // explicit; the route rejects it when it disagrees with the path — otherwise
    // write access to one app would install a policy namespaced to another.
    product: slugSchema.optional(),
    name: z.string().optional(),
    resources: z.array(productResourceDeclSchema),
    roles: z.array(productRoleDeclSchema),
  })
  .strict()
  // Referential integrity, per the contract: "Every referenced resource/action
  // must exist in this same document." A permission naming an undeclared
  // resource or action does not fail at sync time — it namespaces cleanly to
  // `<slug>_Listing:delete` and is simply never matched by anything, so the role
  // silently grants nothing. Catching it at deploy turns an invisible authz hole
  // into a registration failure the product team can see.
  .superRefine((policy, ctx) => {
    const declared = new Map(
      policy.resources.map(r => [r.key, new Set(Object.keys(r.actions))])
    )
    policy.roles.forEach((role, roleIndex) => {
      role.permissions.forEach((permission, permIndex) => {
        const [resourceKey, actionKey] = permission.split(':')
        const actions = declared.get(resourceKey)
        if (!actions) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['roles', roleIndex, 'permissions', permIndex],
            message: `resource '${resourceKey}' is not declared in this policy`,
          })
          return
        }
        if (!actions.has(actionKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['roles', roleIndex, 'permissions', permIndex],
            message: `action '${actionKey}' is not declared on resource '${resourceKey}'`,
          })
        }
      })
    })
  })

export const billingProfileSchema = z
  .object({
    productKey: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'must match ^[a-z0-9][a-z0-9-]*$'),
    currencies: z
      .array(z.string().regex(/^[a-z]{3}$/, 'must be a lowercase ISO-4217 code'))
      .optional(),
    maxTotalCents: z.number().int().min(1).optional(),
  })
  .strict()

export type ProductPolicy = z.infer<typeof productPolicySchema>
export type BillingProfile = z.infer<typeof billingProfileSchema>

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
