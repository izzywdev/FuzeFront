import { z } from 'zod'

// Zod mirrors of ProductPolicy / BillingProfile from the FROZEN contract
// (services/app-registry-service/openapi.yaml). Keep in lock-step with it.
//
// SCOPE NOTE: this validates the SHAPE a product submits. The authoritative
// namespace-and-merge logic (validateProductPolicy / namespaceProductPolicy /
// mergeProductPolicy) already exists in backend/src/permit/product-policy.ts and is
// NOT duplicated here — the applications-service stores what was submitted, and the
// permit-schema sync job (which runs in the backend image, where that logic lives)
// consumes it. Duplicating the merge rules would give two implementations that
// disagree the moment either changes.

// Bare keys are namespaced as `<product>_<Key>`, so the key itself must not contain
// `_` — it is the separator, and the key has to split cleanly at the first one.
const bareKeySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9-]*$/, 'must start with a letter and contain no underscore')

export const productResourceDeclSchema = z
  .object({
    key: bareKeySchema,
    name: z.string().min(1),
    actions: z.record(
      z.string(),
      z.object({ name: z.string().min(1) }).strict()
    ),
  })
  .strict()

export const productRoleDeclSchema = z
  .object({
    key: bareKeySchema,
    name: z.string().min(1),
    permissions: z.array(
      z
        .string()
        .regex(
          /^[A-Za-z][A-Za-z0-9-]*:[A-Za-z][A-Za-z0-9_-]*$/,
          'must be "<Resource>:<action>" using this policy\'s BARE resource keys'
        )
    ),
  })
  .strict()

export const productPolicySchema = z
  .object({
    // Implied by the path slug; permitted in the body only if it agrees (checked in
    // the route, where the slug is known).
    product: z.string().optional(),
    name: z.string().optional(),
    resources: z.array(productResourceDeclSchema),
    roles: z.array(productRoleDeclSchema),
  })
  .strict()
  // Every permission must reference a resource + action declared in THIS document.
  // Catching it here turns a typo into a 400 at deploy instead of a role that
  // silently grants nothing in production.
  .superRefine((policy, ctx) => {
    const actionsByResource = new Map(
      policy.resources.map(r => [r.key, new Set(Object.keys(r.actions))])
    )
    policy.roles.forEach((role, ri) => {
      role.permissions.forEach((perm, pi) => {
        const [resKey, action] = perm.split(':')
        const actions = actionsByResource.get(resKey)
        if (!actions) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['roles', ri, 'permissions', pi],
            message: `references resource "${resKey}" which this policy does not declare`,
          })
        } else if (!actions.has(action)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['roles', ri, 'permissions', pi],
            message: `resource "${resKey}" declares no action "${action}"`,
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
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lowercase alphanumeric with hyphens'),
    currencies: z
      .array(z.string().regex(/^[a-z]{3}$/, 'must be a lowercase ISO-4217 code'))
      .optional(),
    maxTotalCents: z.number().int().positive().optional(),
    meteredUsage: z.boolean().optional(),
  })
  .strict()

export type ProductPolicyInput = z.infer<typeof productPolicySchema>
export type BillingProfileInput = z.infer<typeof billingProfileSchema>
