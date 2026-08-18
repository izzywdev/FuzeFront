// Versioned app-registry router — the FROZEN contract surface mounted at
// /api/v1/app-registry (services/app-registry-service/openapi.yaml). Mounted
// ALONGSIDE the legacy /api/apps router (which is kept for back-compat); this
// router supersedes it. operationIds implemented here 1:1 with the OpenAPI doc:
//   listApps, getApp, registerApp, updateApp, deleteApp,
//   activateApp, suspendApp, heartbeatApp.
import express from 'express'
import { randomBytes } from 'crypto'
// Every route below uses the unified middleware: pre-shared consumer token first,
// then JWT session. authenticateToken is no longer referenced directly here — it
// is reached through authenticateConsumerOrSession's fall-through.
import { authenticateConsumerOrSession } from '../middleware/consumer-auth'
import { isPrefixedIdsEnabled } from '../identity/flags'
import { prefixDtoIds } from '../identity/serializer'
import {
  appManifestSchema,
  registerAppRequestSchema,
  heartbeatRequestSchema,
  productPolicySchema,
  billingProfileSchema,
  toValidationErrorBody,
} from '../app-registry/manifest.schema'
import { appRegistryService, canRead, canMutate } from '../app-registry/service'
import { resolveCaller } from '../app-registry/caller'
import { checkAppRegistryPermission } from '../app-registry/permit'
import { getAppRegistryEmitter } from '../app-registry/events'
import { isV1WriteEnabled, isKafkaEmitEnabled } from '../app-registry/flags'
import { resolvePortalCatalogContext } from '../app-registry/portalContext'

const router = express.Router()

function notFound(res: express.Response) {
  return res.status(404).json({ error: 'not_found', message: 'App not found' })
}
function forbidden(res: express.Response, message = 'Insufficient permissions for this object') {
  return res.status(403).json({ error: 'forbidden', message })
}

/**
 * release flag gate (default OFF) for the new write surface. When the flag is off
 * the write paths are dark — we 503 so the legacy /api/apps remains the path of
 * record until /api/v1/app-registry is deliberately released. Reads are never
 * gated. Fails safe (OFF) if the flag store is unreachable.
 */
async function v1WriteGate(
  caller: { userId: string; organizationIds: string[]; isPlatformAdmin?: boolean },
  organizationId: string | null,
  res: express.Response
): Promise<boolean> {
  if (caller.isPlatformAdmin) return true
  const enabled = await isV1WriteEnabled({
    organizationId: organizationId ?? caller.organizationIds[0],
    userId: caller.userId,
  })
  if (!enabled) {
    res.status(503).json({
      error: 'feature_disabled',
      message: 'The app-registry write API is not yet enabled (fuzefront.app-registry.v1-registry-write)',
    })
    return false
  }
  return true
}

// ── GET /apps — listApps ──────────────────────────────────────────────────────
router.get('/apps', authenticateConsumerOrSession, async (req: any, res) => {
  try {
    const caller = await resolveCaller(req.user)
    const status = req.query.status as any
    const mode = req.query.mode as any
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined

    if (status && !['registered', 'activated', 'suspended'].includes(status)) {
      return res
        .status(400)
        .json({ error: 'validation_error', message: 'invalid status filter' })
    }
    if (mode && !['portal', 'standalone'].includes(mode)) {
      return res
        .status(400)
        .json({ error: 'validation_error', message: 'invalid mode filter' })
    }
    if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
      return res
        .status(400)
        .json({ error: 'validation_error', message: 'invalid limit' })
    }

    // FF-EPIC-12-S2/S5 — resolves to `{ mode: 'off' }` when the
    // fuzefront.apps.portal-catalog flag is OFF, so this is a no-op for every
    // deployment until the flag is deliberately turned on (S5 AC1).
    const portalCtx = await resolvePortalCatalogContext(req)

    const result = await appRegistryService.list({ status, mode, limit, cursor }, caller, portalCtx)
    const flagCtx = { orgId: req.user?.organizationId, userId: req.user?.id }
    const prefixed = await isPrefixedIdsEnabled(flagCtx)
    return res.json({
      ...result,
      apps: result.apps.map((app: any) => prefixDtoIds(app, prefixed, { organizationId: 'organization' })),
    })
  } catch (err) {
    console.error('[app-registry] listApps error:', err)
    return res.status(500).json({ error: 'internal_error', message: 'Failed to list apps' })
  }
})

// ── POST /apps — registerApp ──────────────────────────────────────────────────
router.post('/apps', authenticateConsumerOrSession, async (req: any, res) => {
  try {
    const parsed = registerAppRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json(toValidationErrorBody((parsed as any).error))
    }
    const { manifest, organizationId } = parsed.data
    const orgId = organizationId ?? null

    const caller = await resolveCaller(req.user)
    // release flag (default OFF): the new write surface is dark until released.
    if (!(await v1WriteGate(caller, orgId, res))) return

    // AuthZ: apps:register scoped to the target org (Permit). Object-level: a
    // non-admin caller may only register into an org they belong to.
    if (!caller.isPlatformAdmin) {
      if (orgId && !caller.organizationIds.includes(orgId)) {
        return forbidden(res, 'Cannot register an app into an organization you do not belong to')
      }
      if (!orgId) {
        return forbidden(res, 'Only platform admins may register platform-global apps')
      }
    }
    const permitted = await checkAppRegistryPermission({
      userId: caller.userId,
      action: 'apps:register',
      organizationId: orgId,
      slug: manifest.slug,
    })
    if (!permitted && !caller.isPlatformAdmin) {
      return forbidden(res, 'Missing apps:register scope')
    }

    // Duplicate slug → 409.
    if (await appRegistryService.existsBySlug(manifest.slug)) {
      return res
        .status(409)
        .json({ error: 'conflict', message: 'An app with this slug already exists' })
    }

    const heartbeatToken = randomBytes(32).toString('hex')
    const app = await appRegistryService.register(manifest, orgId, heartbeatToken)

    // Kafka system-of-record event (fail-soft + ops-kill-switch, default ON).
    if (await isKafkaEmitEnabled({ organizationId: orgId, userId: caller.userId })) {
      await getAppRegistryEmitter().appRegistered({
        slug: app.slug,
        name: app.manifest.name,
        mode: app.mode,
        integrationType: app.manifest.integration.type,
        builtin: app.builtin,
        organizationId: app.organizationId ?? undefined,
        registeredAt: app.createdAt,
      })
    }

    // Legacy live UI push (kept; Kafka is system-of-record).
    emitSocket(req, 'app-registered', { app, timestamp: new Date().toISOString() })

    // Return the heartbeat token in a header (out-of-band, not on the App shape).
    res.setHeader('X-App-Heartbeat-Token', heartbeatToken)
    const flagCtx = { orgId: req.user?.organizationId, userId: req.user?.id }
    const prefixed = await isPrefixedIdsEnabled(flagCtx)
    return res.status(201).json(prefixDtoIds(app as any, prefixed, { organizationId: 'organization' }))
  } catch (err: any) {
    // Unique-constraint race → 409.
    if (err?.code === '23505' || /duplicate key|unique/i.test(err?.message || '')) {
      return res
        .status(409)
        .json({ error: 'conflict', message: 'An app with this slug already exists' })
    }
    console.error('[app-registry] registerApp error:', err)
    return res.status(500).json({ error: 'internal_error', message: 'Failed to register app' })
  }
})

// ── GET /apps/:slug — getApp ──────────────────────────────────────────────────
// authenticateConsumerOrSession, not authenticateToken: this is the FIRST call
// register.sh makes (the idempotency probe — 200 = already registered, 404 =
// register now), and it presents the same pre-shared CONSUMER_REGISTRATION_SECRET
// it later uses for POST /apps. With plain JWT auth here the probe 401s and the
// script's `401|403) die` arm CrashLoopBackOffs the consumer's pod before it can
// ever reach the register call. Human OIDC sessions are unaffected — the
// middleware falls through to authenticateToken when the bearer is not the
// pre-shared secret.
router.get('/apps/:slug', authenticateConsumerOrSession, async (req: any, res) => {
  try {
    const caller = await resolveCaller(req.user)
    const app = await appRegistryService.findBySlug(req.params.slug)
    if (!app) return notFound(res)
    // BOLA: do not reveal existence of apps outside the caller's visibility → 404.
    if (!canRead(app, caller)) return notFound(res)
    const flagCtx = { orgId: req.user?.organizationId, userId: req.user?.id }
    const prefixed = await isPrefixedIdsEnabled(flagCtx)
    return res.json(prefixDtoIds(app as any, prefixed, { organizationId: 'organization' }))
  } catch (err) {
    console.error('[app-registry] getApp error:', err)
    return res.status(500).json({ error: 'internal_error', message: 'Failed to get app' })
  }
})

// ── PUT /apps/:slug — updateApp ───────────────────────────────────────────────
// Consumer-secret capable for the same reason as GET above: register.sh re-PUTs
// the manifest on every redeploy so manifest edits (new remoteEntry, changed nav
// placement) are not frozen at first registration.
router.put('/apps/:slug', authenticateConsumerOrSession, async (req: any, res) => {
  try {
    const caller = await resolveCaller(req.user)
    const existing = await appRegistryService.findBySlug(req.params.slug)
    if (!existing) return notFound(res)
    // BOLA: hide non-visible apps as 404; for visible-but-not-owned → handled below.
    if (!canRead(existing, caller)) return notFound(res)
    if (!(await v1WriteGate(caller, existing.organizationId, res))) return

    const parsed = appManifestSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json(toValidationErrorBody((parsed as any).error))
    }
    const manifest = parsed.data

    // Immutable fields must match.
    const fields: { path: string; message: string }[] = []
    if (manifest.slug !== existing.slug) {
      fields.push({ path: 'slug', message: 'slug is immutable' })
    }
    if (manifest.manifestVersion !== existing.manifest.manifestVersion) {
      fields.push({ path: 'manifestVersion', message: 'manifestVersion is immutable' })
    }
    if ((manifest.builtin ?? false) !== existing.builtin) {
      fields.push({ path: 'builtin', message: 'builtin is immutable' })
    }
    if (fields.length > 0) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'immutable field mismatch',
        fields,
      })
    }

    // Object-level + Permit apps:write.
    if (!canMutate(existing, caller)) {
      return forbidden(res)
    }
    const permitted = await checkAppRegistryPermission({
      userId: caller.userId,
      action: 'apps:write',
      organizationId: existing.organizationId,
      slug: existing.slug,
    })
    if (!permitted && !caller.isPlatformAdmin) {
      return forbidden(res, 'Missing apps:write scope')
    }

    const updated = await appRegistryService.updateManifest(existing, manifest)
    const flagCtx = { orgId: req.user?.organizationId, userId: req.user?.id }
    const prefixed = await isPrefixedIdsEnabled(flagCtx)
    return res.json(prefixDtoIds(updated as any, prefixed, { organizationId: 'organization' }))
  } catch (err) {
    console.error('[app-registry] updateApp error:', err)
    return res.status(500).json({ error: 'internal_error', message: 'Failed to update app' })
  }
})

// ── onboarding writes: policy + billing profile ───────────────────────────────
// Both were specified in the contract (putAppPolicy / putAppBillingProfile),
// covered by tests, and given storage by migration 006 + service.setPolicy /
// service.setBillingProfile — but the routes themselves were never mounted, so
// every call 404'd. register.sh treats a non-2xx here as fatal, which meant any
// product shipping a policy.json could not complete registration at all.
//
// Shared preamble: resolve the app, hide invisible apps as 404 (BOLA), apply the
// release gate, then object-level + Permit apps:write. Returns the app on
// success, or null when it has already written a response.
async function resolveForOnboardingWrite(
  req: any,
  res: express.Response
): Promise<{ app: any; caller: any } | null> {
  const caller = await resolveCaller(req.user)
  const app = await appRegistryService.findBySlug(req.params.slug)
  if (!app) {
    notFound(res)
    return null
  }
  if (!canRead(app, caller)) {
    notFound(res)
    return null
  }
  if (!(await v1WriteGate(caller, app.organizationId, res))) return null
  if (!canMutate(app, caller)) {
    forbidden(res)
    return null
  }
  const permitted = await checkAppRegistryPermission({
    userId: caller.userId,
    action: 'apps:write',
    organizationId: app.organizationId,
    slug: app.slug,
  })
  if (!permitted && !caller.isPlatformAdmin) {
    forbidden(res, 'Missing apps:write scope')
    return null
  }
  return { app, caller }
}

// ── PUT /apps/:slug/policy — putAppPolicy ─────────────────────────────────────
router.put('/apps/:slug/policy', authenticateConsumerOrSession, async (req: any, res) => {
  try {
    const resolved = await resolveForOnboardingWrite(req, res)
    if (!resolved) return
    const { app } = resolved

    const parsed = productPolicySchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json(toValidationErrorBody((parsed as any).error))
    }
    const policy = parsed.data

    // `product` is implied by the path. Honouring a disagreeing body value would
    // let apps:write on one app install a policy namespaced to a different one.
    if (policy.product && policy.product !== app.slug) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'policy.product must match the path slug',
        fields: [{ path: 'product', message: `expected '${app.slug}'` }],
      })
    }

    // TODO(platform): storage only. ACCEPTANCE IS NOT PROPAGATION — the roles
    // declared here stay DENY until the permit-schema sync job reads this column
    // (FuzeFront backend boot + post-install/post-upgrade Helm job) and pushes
    // them to Permit. `GET /health` (permit block) reports what the last sync
    // actually applied. A product registering between syncs is live in the
    // registry with a policy that is not yet enforced.
    await appRegistryService.setPolicy(app.slug, policy)

    return res.json({
      slug: app.slug,
      resources: policy.resources.length,
      roles: policy.roles.length,
    })
  } catch (err) {
    console.error('[app-registry] putAppPolicy error:', err)
    return res.status(500).json({ error: 'internal_error', message: 'Failed to store policy' })
  }
})

// ── PUT /apps/:slug/billing-profile — putAppBillingProfile ────────────────────
router.put('/apps/:slug/billing-profile', authenticateConsumerOrSession, async (req: any, res) => {
  try {
    const resolved = await resolveForOnboardingWrite(req, res)
    if (!resolved) return
    const { app } = resolved

    const parsed = billingProfileSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json(toValidationErrorBody((parsed as any).error))
    }
    const profile = parsed.data

    // TODO(platform): storage only, same propagation caveat as policy above —
    // the billing service reads registered profiles to build its productKey
    // allowlist; a profile stored here is not accepted at checkout until it does.
    await appRegistryService.setBillingProfile(app.slug, profile)

    return res.json(profile)
  } catch (err) {
    console.error('[app-registry] putAppBillingProfile error:', err)
    return res
      .status(500)
      .json({ error: 'internal_error', message: 'Failed to store billing profile' })
  }
})

// ── DELETE /apps/:slug — deleteApp ────────────────────────────────────────────
router.delete('/apps/:slug', authenticateConsumerOrSession, async (req: any, res) => {
  try {
    const caller = await resolveCaller(req.user)
    const existing = await appRegistryService.findBySlug(req.params.slug)
    if (!existing) return notFound(res)
    if (!canRead(existing, caller)) return notFound(res)
    if (!(await v1WriteGate(caller, existing.organizationId, res))) return

    // Built-ins cannot be deleted (only suspended) → 403.
    if (existing.builtin) {
      return forbidden(res, 'Built-in apps cannot be deleted (suspend instead)')
    }

    if (!canMutate(existing, caller)) {
      return forbidden(res)
    }
    const permitted = await checkAppRegistryPermission({
      userId: caller.userId,
      action: 'apps:write',
      organizationId: existing.organizationId,
      slug: existing.slug,
    })
    if (!permitted && !caller.isPlatformAdmin) {
      return forbidden(res, 'Missing apps:write scope')
    }

    await appRegistryService.delete(existing.slug)
    return res.status(204).send()
  } catch (err) {
    console.error('[app-registry] deleteApp error:', err)
    return res.status(500).json({ error: 'internal_error', message: 'Failed to delete app' })
  }
})

// ── POST /apps/:slug/activate — activateApp ───────────────────────────────────
router.post('/apps/:slug/activate', authenticateConsumerOrSession, (req, res) =>
  transition(req as any, res, 'activated')
)

// ── POST /apps/:slug/suspend — suspendApp ─────────────────────────────────────
router.post('/apps/:slug/suspend', authenticateConsumerOrSession, (req, res) =>
  transition(req as any, res, 'suspended')
)

async function transition(
  req: any,
  res: express.Response,
  target: 'activated' | 'suspended'
): Promise<express.Response> {
  try {
    const caller = await resolveCaller(req.user)
    const flagCtx = { orgId: req.user?.organizationId, userId: req.user?.id }
    const prefixed = await isPrefixedIdsEnabled(flagCtx)
    const existing = await appRegistryService.findBySlug(req.params.slug)
    if (!existing) return notFound(res)
    if (!canRead(existing, caller)) return notFound(res)
    if (!(await v1WriteGate(caller, existing.organizationId, res))) return res

    if (!canMutate(existing, caller)) {
      return forbidden(res)
    }
    const permitted = await checkAppRegistryPermission({
      userId: caller.userId,
      action: 'apps:activate',
      organizationId: existing.organizationId,
      slug: existing.slug,
    })
    if (!permitted && !caller.isPlatformAdmin) {
      return forbidden(res, 'Missing apps:activate scope')
    }

    // Validate the transition. The state machine is registered → activated →
    // suspended, but both activate and suspend are idempotent no-ops if already
    // in the target state, and an app may be re-activated from suspended.
    if (existing.status === target) {
      return res.json(prefixDtoIds(existing as any, prefixed, { organizationId: 'organization' })) // idempotent no-op
    }

    const updated = await appRegistryService.setStatus(existing.slug, target)

    // ops-kill-switch (default ON): skip async event fan-out only if killed.
    if (await isKafkaEmitEnabled({ organizationId: existing.organizationId, userId: caller.userId })) {
      const emitter = getAppRegistryEmitter()
      if (target === 'activated') {
        await emitter.appActivated({
          slug: updated.slug,
          organizationId: updated.organizationId ?? undefined,
          actorUserId: caller.userId,
          activatedAt: updated.updatedAt,
        })
      } else {
        await emitter.appSuspended({
          slug: updated.slug,
          organizationId: updated.organizationId ?? undefined,
          actorUserId: caller.userId,
          suspendedAt: updated.updatedAt,
        })
      }
    }

    emitSocket(req, 'app-status-changed', {
      appId: updated.slug,
      appName: updated.manifest.name,
      status: target,
      timestamp: new Date().toISOString(),
    })

    return res.json(prefixDtoIds(updated as any, prefixed, { organizationId: 'organization' }))
  } catch (err) {
    console.error('[app-registry]', target, 'error:', err)
    return res.status(500).json({ error: 'internal_error', message: `Failed to ${target} app` })
  }
}

// ── POST /apps/:slug/heartbeat — heartbeatApp ─────────────────────────────────
// Authenticated by a per-app heartbeat token (NOT a user session).
router.post('/apps/:slug/heartbeat', async (req: any, res) => {
  try {
    const parsed = heartbeatRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json(toValidationErrorBody((parsed as any).error))
    }
    const { status, metadata } = parsed.data

    const expectedToken = await appRegistryService.getHeartbeatToken(req.params.slug)
    // App must exist (have a registry row + token).
    const app = await appRegistryService.findBySlug(req.params.slug)
    if (!app || !expectedToken) return notFound(res)

    const header = req.headers['authorization'] || ''
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
    if (!presented || !safeEqual(presented, expectedToken)) {
      return res
        .status(401)
        .json({ error: 'unauthorized', message: 'Invalid app heartbeat token' })
    }

    const at = new Date()
    const healthy = status === 'online'
    await appRegistryService.recordHeartbeat(app.slug, healthy, at)

    // ops-kill-switch (default ON). No user session here (token-auth), so the
    // flag context carries the app's org only.
    if (await isKafkaEmitEnabled({ organizationId: app.organizationId })) {
      await getAppRegistryEmitter().appHeartbeat({
        slug: app.slug,
        status,
        metadata,
        seenAt: at.toISOString(),
      })
    }

    emitSocket(req, 'app-status-changed', {
      appId: app.slug,
      appName: app.manifest.name,
      status,
      isHealthy: healthy,
      timestamp: at.toISOString(),
      metadata,
    })

    return res.json({ accepted: true, at: at.toISOString() })
  } catch (err) {
    console.error('[app-registry] heartbeat error:', err)
    return res.status(500).json({ error: 'internal_error', message: 'Failed to process heartbeat' })
  }
})

function emitSocket(req: any, event: string, payload: unknown): void {
  try {
    const io = req.app.get('io')
    if (io) io.emit(event, payload)
  } catch {
    /* live push is best-effort */
  }
}

/** Constant-time-ish token comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Re-export so callers/tests can reference the configured router.
export { router }
export default router
