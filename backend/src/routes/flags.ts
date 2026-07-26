// Feature-flag read surface for the browser.
//
// The host shell cannot talk to Unleash directly: Unleash's frontend API trusts
// the client-supplied evaluation context, so any user could pass the platform
// owner's userId and enrol themselves into the `developers` segment. Here the
// context is derived from the AUTHENTICATED session, so the cohort is
// tamper-proof, no Unleash token reaches the browser, and no new public host is
// needed (/api/* is already same-origin routed).
//
// Flags are evaluated through @fuzefront/feature-flags (OpenFeature); every
// failure path returns the flag's declared fail-safe default, so an Unleash
// outage degrades to "release flags OFF" rather than erroring the shell.
import { Router, Response } from 'express'
import { authenticateToken } from '../middleware/auth'

const router = Router()

type FlagDescriptor = { key: string; type: string; default: boolean }

/**
 * Resolve the flag catalog + client lazily so the route module never hard-fails
 * where the flag package is absent — the endpoint then serves defaults.
 */
function loadFlags(): {
  catalog: FlagDescriptor[]
  client: {
    getBooleanValue(
      key: string,
      def: boolean,
      ctx?: Record<string, unknown>
    ): Promise<boolean>
  } | null
} {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@fuzefront/feature-flags')
    const catalog: FlagDescriptor[] = Array.isArray(mod.WEB_EXPOSED_FLAGS)
      ? mod.WEB_EXPOSED_FLAGS
      : []
    const client = typeof mod.getClient === 'function' ? mod.getClient() : null
    return { catalog, client }
  } catch {
    return { catalog: [], client: null }
  }
}

/**
 * GET /api/flags — evaluated flags for the current session user.
 *
 * Response: { flags: { "<key>": boolean, ... } }
 * Only catalog-listed (browser-exposed) flags are returned; server-only flags
 * are never disclosed.
 */
router.get('/', authenticateToken, async (req: any, res: Response) => {
  const { catalog, client } = loadFlags()

  const context = {
    environment: process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local',
    app: 'fuzefront-host',
    // userId -> OpenFeature targetingKey -> Unleash `userId`, the field the
    // `developers` segment constrains. Taken from the verified session, never
    // from the request body/query.
    userId: req.user?.id,
    orgId: req.user?.organizationId ?? req.user?.defaultOrganizationId ?? undefined,
  }

  const flags: Record<string, boolean> = {}
  for (const descriptor of catalog) {
    if (!client) {
      flags[descriptor.key] = descriptor.default
      continue
    }
    try {
      flags[descriptor.key] = await client.getBooleanValue(
        descriptor.key,
        descriptor.default,
        context
      )
    } catch {
      flags[descriptor.key] = descriptor.default
    }
  }

  // Per-user evaluation — must never be shared by a cache.
  res.set('Cache-Control', 'private, no-store')
  res.json({ flags })
})

export default router
