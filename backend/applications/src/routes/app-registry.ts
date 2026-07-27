// Versioned app-registry router — the FROZEN contract surface mounted at
// /api/v1/app-registry (services/app-registry-service/openapi.yaml). Mounted
// ALONGSIDE the legacy /api/apps router (which is kept for back-compat); this
// router supersedes it. operationIds implemented here 1:1 with the OpenAPI doc:
//   listApps, getApp, registerApp, updateApp, deleteApp,
//   activateApp, suspendApp, heartbeatApp.
import express from 'express'
import { randomBytes } from 'crypto'
import { authenticateToken } from '../middleware/auth'
import {
  appManifestSchema,
  registerAppRequestSchema,
  heartbeatRequestSchema,
  toValidationErrorBody,
} from '../app-registry/manifest.schema'
import { appRegistryService, canRead, canMutate } from '../app-registry/service'
import { resolveCaller } from '../app-registry/caller'
import { checkAppRegistryPermission } from '../app-registry/permit'
import { getAppRegistryEmitter } from '../app-registry/events'
import { isV1WriteEnabled, isKafkaEmitEnabled } from '../app-registry/flags'

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
router.get('/apps', authenticateToken, async (req: any, res) => {
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

    const result = await appRegistryService.list({ status, mode, limit, cursor }, caller)
    return res.json(result)
  } catch (err) {
    console.error('[app-registry] listApps error:', err)
    return res.status(500).json({ error: 'internal_error', message: 'Failed to list apps' })
  }
})

// ── POST /apps — registerApp ──────────────────────────────────────────────────
router.post('/apps', authenticateToken, async (req: any, res) => {
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
    return res.status(201).json(app)
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
router.get('/apps/:slug', authenticateToken, async (req: any, res) => {
  try {
    const caller = await resolveCaller(req.user)
    const app = await appRegistryService.findBySlug(req.params.slug)
    if (!app) return notFound(res)
    // BOLA: do not reveal existence of apps outside the caller's visibility → 404.
    if (!canRead(app, caller)) return notFound(res)
    return res.json(app)
  } catch (err) {
    console.error('[app-registry] getApp error:', err)
    return res.status(500).json({ error: 'internal_error', message: 'Failed to get app' })
  }
})

// ── PUT /apps/:slug — updateApp ───────────────────────────────────────────────
router.put('/apps/:slug', authenticateToken, async (req: any, res) => {
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
    return res.json(updated)
  } catch (err) {
    console.error('[app-registry] updateApp error:', err)
    return res.status(500).json({ error: 'internal_error', message: 'Failed to update app' })
  }
})

// ── DELETE /apps/:slug — deleteApp ────────────────────────────────────────────
router.delete('/apps/:slug', authenticateToken, async (req: any, res) => {
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
router.post('/apps/:slug/activate', authenticateToken, (req, res) =>
  transition(req as any, res, 'activated')
)

// ── POST /apps/:slug/suspend — suspendApp ─────────────────────────────────────
router.post('/apps/:slug/suspend', authenticateToken, (req, res) =>
  transition(req as any, res, 'suspended')
)

async function transition(
  req: any,
  res: express.Response,
  target: 'activated' | 'suspended'
): Promise<express.Response> {
  try {
    const caller = await resolveCaller(req.user)
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
      return res.json(existing) // idempotent no-op
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

    return res.json(updated)
  } catch (err) {
    console.error(`[app-registry] ${target} error:`, err)
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
