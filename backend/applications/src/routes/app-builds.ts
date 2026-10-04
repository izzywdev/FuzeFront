// "Build your application" + marketplace publication — mounted at
// /api/v1/app-registry ALONGSIDE routes/app-registry.ts (same prefix, so it
// rides the existing ingress / host-backend route-ownership entry for
// /api/v1/app-registry; see scripts/check-route-ownership.mjs).
//
// operationIds (services/app-registry-service/openapi.yaml):
//   createBuildSession, listBuildSessions, getBuildSession, cancelBuildSession,
//   reportBuildSessionStatus,
//   requestAppPublication, approveAppPublication, rejectAppPublication,
//   getAppPublication.
//
// Flags (release, default OFF, fail-safe):
//   fuzefront.apps.build-with-agent        -> every /build-sessions* endpoint
//   fuzefront.apps.marketplace-publishing  -> every /apps/{slug}/publication* endpoint
//   fuzefront.apps.creator-ownership       -> creator role/column on `deployed`
// A flag is rollout convenience ONLY. Authority is Permit (apps:register /
// apps:write) + org role; the flag never replaces a check.
//
// Identifiers (governance/identifier-standard.md): the session id is
// server-minted with mintId('appBuildSession'); no create body accepts an id
// (zod .strict()); every incoming org reference is validated with parseId; the
// wire form is always the prefixed TypeID, storage is a native uuid.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { mintId, toUuid, parseId, isUuid } from '@izzywdev/fuzefront-identity'
import { authenticateConsumerOrSession, SYNTHETIC_CONSUMER_USER_ID } from '../middleware/consumer-auth'
import { resolveCaller } from '../app-registry/caller'
import { appRegistryService, canRead, canMutate } from '../app-registry/service'
import { checkAppRegistryPermission, assignAppCreatorRole } from '../app-registry/permit'
import {
  isBuildWithAgentEnabled,
  isCreatorOwnershipEnabled,
  isMarketplacePublishingEnabled,
} from '../app-registry/flags'
import { toValidationErrorBody } from '../app-registry/manifest.schema'
import {
  getBuildSessionStore,
  encodeSessionCursor,
  decodeSessionCursor,
  CANCELLABLE_STATUSES,
  TERMINAL_STATUSES,
  type BuildSessionRow,
  type BuildStatus,
} from '../app-registry/build-sessions'
import { getBuilderLauncher } from '../app-registry/builder-launcher'
import { toWireId } from '../identity/serializer'
import { log, errInfo } from '../app-registry/log'

const router = express.Router()

// ── rate limiting ─────────────────────────────────────────────────────────────
// Same express-rate-limit convention as routes/app-installations.ts: ALWAYS
// mounted, env-overridable ceilings (test suites raise them, never skip them).
// Writes are tight because each create fans out to an external agent launch;
// reads also drive 404-not-403 id probing so they are bounded too.
const READ_LIMIT = parseInt(process.env.APP_BUILD_READ_RATE_LIMIT || '60', 10)
const WRITE_LIMIT = parseInt(process.env.APP_BUILD_WRITE_RATE_LIMIT || '10', 10)
const CALLBACK_LIMIT = parseInt(process.env.APP_BUILD_CALLBACK_RATE_LIMIT || '120', 10)
const limiter = (limit: number) =>
  rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again shortly.' },
  })
export const buildReadRateLimiter = limiter(READ_LIMIT)
export const buildWriteRateLimiter = limiter(WRITE_LIMIT)
export const buildCallbackRateLimiter = limiter(CALLBACK_LIMIT)

// ── constants / schemas ───────────────────────────────────────────────────────
export const BRIEF_MAX = 4000
const NAME_MAX = 120
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const ORG_MANAGER_ROLES = new Set(['owner', 'admin'])

const createBuildSessionSchema = z
  .object({
    context: z.enum(['personal', 'organization']),
    organizationId: z.string().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(NAME_MAX),
    brief: z.string().trim().min(1).max(BRIEF_MAX),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.context === 'organization' && !v.organizationId) {
      ctx.addIssue({
        code: 'custom',
        path: ['organizationId'],
        message: 'organizationId is required when context is "organization"',
      })
    }
    if (v.context === 'personal' && v.organizationId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['organizationId'],
        message: 'organizationId must not be supplied when context is "personal"',
      })
    }
  })

const reportStatusSchema = z
  .object({
    status: z.enum(['building', 'deploying', 'deployed', 'failed']),
    appSlug: z.string().min(1).max(200).optional(),
    errorCode: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,64}$/)
      .optional(),
    errorMessage: z.string().max(2000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status === 'deployed' && !v.appSlug) {
      ctx.addIssue({ code: 'custom', path: ['appSlug'], message: 'appSlug is required when status is "deployed"' })
    }
    if (v.status !== 'deployed' && v.appSlug !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['appSlug'], message: 'appSlug is only valid when status is "deployed"' })
    }
    if (v.status !== 'failed' && (v.errorCode !== undefined || v.errorMessage !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['errorCode'], message: 'errorCode/errorMessage are only valid when status is "failed"' })
    }
  })

const publicationRequestSchema = z
  .object({
    target: z.literal('marketplace'),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()

const publicationRejectSchema = z.object({ reason: z.string().trim().min(1).max(2000) }).strict()
const publicationApproveSchema = z.object({ notes: z.string().trim().max(2000).optional() }).strict()

// ── helpers ───────────────────────────────────────────────────────────────────
const featureDisabled = (res: express.Response, flag: string, what: string) =>
  res.status(503).json({
    error: 'feature_disabled',
    message: `${what} is not yet enabled (${flag})`,
  })
const notFound = (res: express.Response, message = 'Not found') =>
  res.status(404).json({ error: 'not_found', message })
const forbidden = (res: express.Response, message = 'Insufficient permissions for this object') =>
  res.status(403).json({ error: 'forbidden', message })

function parseOrgId(raw: string): string | null {
  try {
    return toUuid(parseId('organization', raw))
  } catch {
    // Bare uuid (e.g. the platform root org constant) is accepted, as in registerApp.
    return isUuid(raw) ? raw : null
  }
}

function parseSessionId(raw: string): string | null {
  try {
    return toUuid(parseId('appBuildSession', raw))
  } catch {
    return null
  }
}

function toSessionDto(row: BuildSessionRow) {
  return {
    id: toWireId('appBuildSession', row.id, true),
    organizationId: toWireId('organization', row.organization_id, true),
    requestedBy: row.requested_by_user_id ? toWireId('user', row.requested_by_user_id, true) : null,
    context: row.context,
    name: row.name,
    brief: row.brief,
    status: row.status,
    appId: row.app_id ? toWireId('app', row.app_id, true) : null,
    appSlug: row.app_slug ?? null,
    agentSessionUrl: row.agent_session_url ?? null,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

/** Org manager = active owner/admin of the org, or a platform admin. */
async function canManageOrg(
  caller: { userId: string; isPlatformAdmin?: boolean },
  organizationId: string
): Promise<boolean> {
  if (caller.isPlatformAdmin) return true
  if (caller.userId === SYNTHETIC_CONSUMER_USER_ID) return false
  const role = await getBuildSessionStore().getOrgRole(caller.userId, organizationId)
  return role !== null && ORG_MANAGER_ROLES.has(role)
}

async function canSeeSession(caller: any, row: BuildSessionRow): Promise<boolean> {
  if (row.requested_by_user_id && row.requested_by_user_id === caller.userId) return true
  return canManageOrg(caller, row.organization_id)
}

const buildGate = async (
  res: express.Response,
  ctx: { organizationId?: string | null; userId?: string }
): Promise<boolean> => {
  if (await isBuildWithAgentEnabled(ctx)) return true
  featureDisabled(res, 'fuzefront.apps.build-with-agent', 'The build-with-agent API')
  return false
}

const publishGate = async (
  res: express.Response,
  ctx: { organizationId?: string | null; userId?: string }
): Promise<boolean> => {
  if (await isMarketplacePublishingEnabled(ctx)) return true
  featureDisabled(res, 'fuzefront.apps.marketplace-publishing', 'Marketplace publishing')
  return false
}

// ── POST /build-sessions — createBuildSession ────────────────────────────────
router.post(
  '/build-sessions',
  buildWriteRateLimiter,
  authenticateConsumerOrSession,
  async (req: any, res) => {
    try {
      const caller = await resolveCaller(req.user)
      // The service account has no users row (and the requester FK is a uuid):
      // it may report status, never start a build.
      if (caller.userId === SYNTHETIC_CONSUMER_USER_ID) {
        return forbidden(res, 'Service accounts cannot start build sessions')
      }
      if (!(await buildGate(res, { organizationId: caller.organizationIds[0], userId: caller.userId }))) return

      const parsed = createBuildSessionSchema.safeParse(req.body)
      if (!parsed.success) return res.status(400).json(toValidationErrorBody((parsed as any).error))
      const body = parsed.data
      const store = getBuildSessionStore()

      // ── resolve the owning org (the owner of record) ──
      let organizationId: string
      if (body.context === 'personal') {
        const personal = await store.findPersonalOrgId(caller.userId)
        if (!personal) {
          log.info('build-session create rejected: no personal org', { userId: caller.userId })
          return res.status(409).json({
            error: 'no_personal_org',
            message: 'You do not have a personal account to build into yet',
          })
        }
        organizationId = personal
      } else {
        const orgUuid = parseOrgId(body.organizationId as string)
        if (!orgUuid) {
          return res.status(400).json({
            error: 'validation_error',
            message: 'Request body failed validation',
            fields: [{ path: 'organizationId', message: 'not a valid organization id' }],
          })
        }
        const role = await store.getOrgRole(caller.userId, orgUuid)
        if (role === null) {
          if (!caller.isPlatformAdmin) {
            log.warn('build-session create denied: not a member', { userId: caller.userId, organizationId: orgUuid })
            return forbidden(res, 'Cannot build into an organization you do not belong to')
          }
          if (!(await store.orgExists(orgUuid))) return notFound(res, 'Organization not found')
        }
        const permitted = await checkAppRegistryPermission({
          userId: caller.userId,
          action: 'apps:register',
          organizationId: orgUuid,
        })
        if (!permitted && !caller.isPlatformAdmin) {
          log.warn('build-session create denied: missing apps:register', { userId: caller.userId, organizationId: orgUuid })
          return forbidden(res, 'Missing apps:register scope')
        }
        organizationId = orgUuid
      }

      // ── launcher must be configured BEFORE anything is persisted ──
      const launcher = getBuilderLauncher()
      if (!launcher) {
        log.error('build-session create: builder launcher not configured', { userId: caller.userId })
        return res.status(503).json({
          error: 'builder_unavailable',
          message: 'The application builder is not configured on this server',
        })
      }

      const sessionWireId = mintId('appBuildSession') // server-minted; never from the client
      const id = toUuid(sessionWireId)
      const now = new Date()
      await store.insert({
        id,
        organization_id: organizationId,
        requested_by_user_id: caller.userId,
        context: body.context,
        name: body.name,
        brief: body.brief,
        status: 'launching',
        app_id: null,
        agent_session_ref: null,
        agent_session_url: null,
        error_code: null,
        error_message: null,
        created_at: now,
        updated_at: now,
      })
      log.info('build-session created', { buildSessionId: sessionWireId, organizationId, context: body.context })

      try {
        const launched = await launcher.launch({
          buildSessionId: sessionWireId,
          organizationId: toWireId('organization', organizationId, true),
          requestedByUserId: toWireId('user', caller.userId, true),
          context: body.context,
          name: body.name,
          brief: body.brief,
        })
        const moved = await store.transition(id, ['launching'], {
          status: 'building',
          agent_session_ref: launched.agentSessionRef,
          agent_session_url: launched.agentSessionUrl ?? null,
        })
        if (!moved) {
          // The agent (or the user) already moved the session on while launch()
          // was returning — keep the refs, do NOT regress the status.
          await store.patch(id, {
            agent_session_ref: launched.agentSessionRef,
            agent_session_url: launched.agentSessionUrl ?? null,
          })
        }
        const row = (await store.findById(id)) as BuildSessionRow
        return res.status(201).json(toSessionDto(row))
      } catch (err) {
        log.error('build-session launch failed', { buildSessionId: sessionWireId, ...errInfo(err) })
        await store
          .transition(id, ['launching'], {
            status: 'failed',
            error_code: 'launch_failed',
            error_message: String((err as any)?.message ?? 'launch failed').slice(0, 500),
          })
          .catch(e => log.error('build-session mark-failed errored', errInfo(e)))
        return res.status(502).json({
          error: 'launch_failed',
          message: 'Could not start the FuzeAgent build session',
        })
      }
    } catch (err) {
      log.error('createBuildSession error', errInfo(err))
      return res.status(500).json({ error: 'internal_error', message: 'Failed to create build session' })
    }
  }
)

// ── GET /build-sessions — listBuildSessions ──────────────────────────────────
router.get(
  '/build-sessions',
  buildReadRateLimiter,
  authenticateConsumerOrSession,
  async (req: any, res) => {
    try {
      const caller = await resolveCaller(req.user)
      if (caller.userId === SYNTHETIC_CONSUMER_USER_ID) return forbidden(res, 'Service accounts cannot list build sessions')
      if (!(await buildGate(res, { organizationId: caller.organizationIds[0], userId: caller.userId }))) return

      let limit = DEFAULT_LIMIT
      if (req.query.limit !== undefined) {
        limit = parseInt(String(req.query.limit), 10)
        if (Number.isNaN(limit) || limit < 1) {
          return res.status(400).json({ error: 'validation_error', message: 'invalid limit' })
        }
        limit = Math.min(limit, MAX_LIMIT) // clamp, never trust the client
      }
      let cursor: { createdAt: string; id: string } | null = null
      if (req.query.cursor !== undefined) {
        cursor = decodeSessionCursor(String(req.query.cursor))
        if (!cursor) return res.status(400).json({ error: 'validation_error', message: 'invalid cursor' })
      }

      let organizationId: string | undefined
      let includeAllInOrg = false
      if (req.query.organizationId !== undefined) {
        const orgUuid = parseOrgId(String(req.query.organizationId))
        if (!orgUuid) return res.status(400).json({ error: 'validation_error', message: 'invalid organizationId' })
        organizationId = orgUuid
        includeAllInOrg = await canManageOrg(caller, orgUuid)
      }

      const rows = await getBuildSessionStore().list({
        requesterId: caller.userId,
        organizationId,
        includeAllInOrg,
        limit,
        cursor,
      })
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      return res.json({
        items: page.map(toSessionDto),
        page: {
          nextCursor: hasMore ? encodeSessionCursor(page[page.length - 1]) : null,
          hasMore,
        },
      })
    } catch (err) {
      log.error('listBuildSessions error', errInfo(err))
      return res.status(500).json({ error: 'internal_error', message: 'Failed to list build sessions' })
    }
  }
)

// ── GET /build-sessions/:id — getBuildSession ────────────────────────────────
router.get(
  '/build-sessions/:id',
  buildReadRateLimiter,
  authenticateConsumerOrSession,
  async (req: any, res) => {
    try {
      const caller = await resolveCaller(req.user)
      if (!(await buildGate(res, { organizationId: caller.organizationIds[0], userId: caller.userId }))) return
      const id = parseSessionId(req.params.id)
      if (!id) return notFound(res, 'Build session not found')
      const row = await getBuildSessionStore().findById(id)
      // 404 (never 403) for both "missing" and "not entitled": indistinguishable.
      if (!row || caller.userId === SYNTHETIC_CONSUMER_USER_ID || !(await canSeeSession(caller, row))) {
        return notFound(res, 'Build session not found')
      }
      return res.json(toSessionDto(row))
    } catch (err) {
      log.error('getBuildSession error', errInfo(err))
      return res.status(500).json({ error: 'internal_error', message: 'Failed to get build session' })
    }
  }
)

// ── POST /build-sessions/:id/cancel — cancelBuildSession ─────────────────────
router.post(
  '/build-sessions/:id/cancel',
  buildWriteRateLimiter,
  authenticateConsumerOrSession,
  async (req: any, res) => {
    try {
      const caller = await resolveCaller(req.user)
      if (!(await buildGate(res, { organizationId: caller.organizationIds[0], userId: caller.userId }))) return
      const id = parseSessionId(req.params.id)
      if (!id) return notFound(res, 'Build session not found')
      const store = getBuildSessionStore()
      const row = await store.findById(id)
      if (!row || caller.userId === SYNTHETIC_CONSUMER_USER_ID || !(await canSeeSession(caller, row))) {
        return notFound(res, 'Build session not found')
      }
      const moved = await store.transition(id, CANCELLABLE_STATUSES, { status: 'cancelled' })
      if (!moved) {
        log.info('build-session cancel rejected: terminal', { buildSessionId: req.params.id, status: row.status })
        return res.status(409).json({
          error: 'conflict',
          message: `A build session in status "${row.status}" cannot be cancelled`,
        })
      }
      // NOTE: this stops the platform-side session only; the agent is not
      // signalled (the FuzeAgent build API exposes no cancel yet) and a later
      // status callback is rejected 409 because 'cancelled' is terminal.
      log.info('build-session cancelled', { buildSessionId: req.params.id, by: caller.userId })
      return res.json(toSessionDto((await store.findById(id)) as BuildSessionRow))
    } catch (err) {
      log.error('cancelBuildSession error', errInfo(err))
      return res.status(500).json({ error: 'internal_error', message: 'Failed to cancel build session' })
    }
  }
)

// ── POST /build-sessions/:id/status — reportBuildSessionStatus (agent callback)
const STATUS_RANK: Partial<Record<BuildStatus, number>> = {
  requested: 0,
  launching: 1,
  building: 2,
  deploying: 3,
  deployed: 4,
}

router.post(
  '/build-sessions/:id/status',
  buildCallbackRateLimiter,
  authenticateConsumerOrSession,
  async (req: any, res) => {
    try {
      const caller = await resolveCaller(req.user)
      // Only the platform service account (or a platform admin) may report
      // status. A session's own requester must NOT be able to mark their build
      // "deployed" — that would link an arbitrary app to the session.
      if (!caller.isPlatformAdmin) {
        log.warn('build-session status callback denied: not platform admin', { userId: caller.userId })
        return forbidden(res, 'Only the platform builder service may report build status')
      }
      const id = parseSessionId(req.params.id)
      if (!id) return notFound(res, 'Build session not found')
      const store = getBuildSessionStore()
      const row = await store.findById(id)
      if (!row) return notFound(res, 'Build session not found')

      const flagCtx = {
        organizationId: row.organization_id,
        userId: row.requested_by_user_id ?? undefined,
      }
      if (!(await buildGate(res, flagCtx))) return

      const parsed = reportStatusSchema.safeParse(req.body)
      if (!parsed.success) return res.status(400).json(toValidationErrorBody((parsed as any).error))
      const body = parsed.data

      // Forward-only; terminal states are immutable.
      if (TERMINAL_STATUSES.includes(row.status)) {
        return res.status(409).json({
          error: 'conflict',
          message: `Build session is already ${row.status}`,
        })
      }
      const targetRank = STATUS_RANK[body.status as BuildStatus]
      const currentRank = STATUS_RANK[row.status] as number
      if (body.status !== 'failed' && (targetRank as number) <= currentRank) {
        return res.status(409).json({
          error: 'conflict',
          message: `Cannot move a build session from "${row.status}" to "${body.status}"`,
        })
      }
      // Race-safe: the CAS only matches while the status is still earlier.
      const fromStatuses = (Object.keys(STATUS_RANK) as BuildStatus[]).filter(
        s => body.status === 'failed' || (STATUS_RANK[s] as number) < (targetRank as number)
      )

      let patch: Partial<BuildSessionRow> = { status: body.status as BuildStatus }
      let linkedSlug: string | null = null

      if (body.status === 'deployed') {
        const appRef = await store.findAppBySlug(body.appSlug as string)
        if (!appRef) {
          return res.status(422).json({
            error: 'unprocessable_entity',
            message: 'No app is registered under that slug',
            code: 'APP_NOT_FOUND',
          })
        }
        // An agent must never deploy into a different tenant than the session.
        if (appRef.organization_id !== row.organization_id) {
          log.warn('build-session deployed REJECTED: cross-tenant app', {
            buildSessionId: req.params.id,
            sessionOrganizationId: row.organization_id,
            appOrganizationId: appRef.organization_id,
            appSlug: appRef.slug,
          })
          return res.status(409).json({
            error: 'conflict',
            message: 'The deployed app belongs to a different organization than this build session',
            code: 'ORG_MISMATCH',
          })
        }
        patch = { ...patch, app_id: appRef.id }
        linkedSlug = appRef.slug
      } else if (body.status === 'failed') {
        patch = {
          ...patch,
          error_code: body.errorCode ?? 'agent_failed',
          error_message: body.errorMessage ?? null,
        }
      }

      const moved = await store.transition(id, fromStatuses, patch)
      if (!moved) {
        return res.status(409).json({
          error: 'conflict',
          message: 'Build session changed state concurrently; re-read and retry',
        })
      }
      log.info('build-session status', { buildSessionId: req.params.id, from: row.status, to: body.status })

      // Creator ownership (flag fuzefront.apps.creator-ownership): the human who
      // requested the build becomes the app's creator of record, ONLY if the app
      // has none yet (immutable once set), and gets the initial creator role.
      if (
        body.status === 'deployed' &&
        linkedSlug &&
        row.requested_by_user_id &&
        (await isCreatorOwnershipEnabled(flagCtx))
      ) {
        const wrote = await appRegistryService.setCreatorIfUnset(linkedSlug, row.requested_by_user_id)
        if (wrote) {
          await assignAppCreatorRole({
            userId: row.requested_by_user_id,
            organizationId: row.organization_id,
            slug: linkedSlug,
          })
        }
      }

      return res.json(toSessionDto((await store.findById(id)) as BuildSessionRow))
    } catch (err) {
      log.error('reportBuildSessionStatus error', errInfo(err))
      return res.status(500).json({ error: 'internal_error', message: 'Failed to record build status' })
    }
  }
)

// ══ Marketplace publication (flag fuzefront.apps.marketplace-publishing) ══════
//
// Tiers: private -> organization (existing `visibility` PUT) -> marketplace
// (FuzeFront app store). Marketplace goes through a submit / approve|reject
// review reusing apps.marketplace_submitted_at, is_marketplace_approved,
// marketplace_approved_at, approved_by, marketplace_metadata and
// visibility='marketplace'.

function publicationStatus(p: {
  submittedAt: string | null
  isApproved: boolean
  metadata: Record<string, any>
}): 'none' | 'pending' | 'approved' | 'rejected' {
  if (p.isApproved) return 'approved'
  if (p.submittedAt) return 'pending'
  if (p.metadata?.publication?.rejection) return 'rejected'
  return 'none'
}

function toPublicationDto(slug: string, tier: string, p: any) {
  const pub = p.metadata?.publication ?? {}
  const wireUser = (v: unknown) => (typeof v === 'string' && v ? toWireId('user', v, true) : null)
  return {
    slug,
    tier,
    status: publicationStatus(p),
    target: 'marketplace' as const,
    submittedAt: p.submittedAt,
    approvedAt: p.approvedAt,
    approvedBy: wireUser(p.approvedBy),
    requestedBy: wireUser(pub.requestedBy),
    notes: pub.notes ?? null,
    rejection: pub.rejection
      ? {
          reason: pub.rejection.reason,
          rejectedAt: pub.rejection.rejectedAt,
          rejectedBy: wireUser(pub.rejection.rejectedBy),
        }
      : null,
  }
}

/** Resolve a readable app + caller; writes the 404 itself on miss. */
async function loadAppForPublication(req: any, res: express.Response) {
  const caller = await resolveCaller(req.user)
  const app = await appRegistryService.findBySlug(req.params.slug)
  if (!app || !canRead(app, caller)) {
    notFound(res, 'App not found')
    return null
  }
  return { caller, app }
}

const realUserId = (id: string): string | null => (id === SYNTHETIC_CONSUMER_USER_ID ? null : id)

// ── POST /apps/:slug/publication-requests — requestAppPublication ────────────
router.post(
  '/apps/:slug/publication-requests',
  buildWriteRateLimiter,
  authenticateConsumerOrSession,
  async (req: any, res) => {
    try {
      const loaded = await loadAppForPublication(req, res)
      if (!loaded) return
      const { caller, app } = loaded
      if (!(await publishGate(res, { organizationId: app.organizationId, userId: caller.userId }))) return

      if (!canMutate(app, caller)) return forbidden(res)
      const permitted = await checkAppRegistryPermission({
        userId: caller.userId,
        action: 'apps:write',
        organizationId: app.organizationId,
        slug: app.slug,
      })
      if (!permitted && !caller.isPlatformAdmin) return forbidden(res, 'Missing apps:write scope')

      const parsed = publicationRequestSchema.safeParse(req.body)
      if (!parsed.success) return res.status(400).json(toValidationErrorBody((parsed as any).error))

      const current = await appRegistryService.getPublication(app.slug)
      if (current?.isApproved) {
        return res.status(409).json({ error: 'conflict', message: 'App is already published to the marketplace', code: 'ALREADY_PUBLISHED' })
      }
      if (current?.submittedAt) {
        return res.status(409).json({ error: 'conflict', message: 'A marketplace publication request is already pending', code: 'ALREADY_PENDING' })
      }

      const pub = await appRegistryService.submitPublication(app.slug, {
        target: 'marketplace',
        notes: parsed.data.notes ?? null,
        requestedBy: realUserId(caller.userId),
        requestedAt: new Date().toISOString(),
      })
      log.info('publication requested', { slug: app.slug, by: caller.userId })
      return res.status(201).json(toPublicationDto(app.slug, app.manifest.visibility ?? 'private', pub))
    } catch (err) {
      log.error('requestAppPublication error', errInfo(err))
      return res.status(500).json({ error: 'internal_error', message: 'Failed to request publication' })
    }
  }
)

// ── POST /apps/:slug/publication-requests/approve|reject ─────────────────────
async function decide(req: any, res: express.Response, decision: 'approve' | 'reject') {
  try {
    const loaded = await loadAppForPublication(req, res)
    if (!loaded) return
    const { caller, app } = loaded
    if (!(await publishGate(res, { organizationId: app.organizationId, userId: caller.userId }))) return

    // Marketplace review is a PLATFORM decision: platform admins only. (The app
    // is readable to this caller, so a plain 403 reveals nothing.)
    if (!caller.isPlatformAdmin) {
      log.warn('publication decision denied: not platform admin', { slug: app.slug, userId: caller.userId })
      return forbidden(res, 'Only platform admins can review marketplace publication requests')
    }

    let reason: string | undefined
    let notes: string | undefined
    if (decision === 'reject') {
      const parsed = publicationRejectSchema.safeParse(req.body)
      if (!parsed.success) return res.status(400).json(toValidationErrorBody((parsed as any).error))
      reason = parsed.data.reason
    } else {
      const parsed = publicationApproveSchema.safeParse(req.body ?? {})
      if (!parsed.success) return res.status(400).json(toValidationErrorBody((parsed as any).error))
      notes = parsed.data.notes
    }

    const current = await appRegistryService.getPublication(app.slug)
    if (!current?.submittedAt || current.isApproved) {
      return res.status(409).json({
        error: 'conflict',
        message: 'There is no pending marketplace publication request for this app',
        code: 'NOT_PENDING',
      })
    }

    const by = realUserId(caller.userId)
    const at = new Date().toISOString()
    const pub =
      decision === 'approve'
        ? await appRegistryService.approvePublication(app.slug, by, {
            approvalNotes: notes ?? null,
            approvedBy: by,
          })
        : await appRegistryService.rejectPublication(app.slug, {
            rejection: { reason, rejectedAt: at, rejectedBy: by },
          })
    log.info(decision === 'approve' ? 'publication approved' : 'publication rejected', { slug: app.slug, by: caller.userId })
    const tier = decision === 'approve' ? 'marketplace' : app.manifest.visibility ?? 'private'
    return res.json(toPublicationDto(app.slug, tier, pub))
  } catch (err) {
    log.error(`${decision}AppPublication error`, errInfo(err))
    return res.status(500).json({ error: 'internal_error', message: `Failed to ${decision} publication` })
  }
}
router.post('/apps/:slug/publication-requests/approve', buildWriteRateLimiter, authenticateConsumerOrSession, (req, res) =>
  decide(req, res, 'approve')
)
router.post('/apps/:slug/publication-requests/reject', buildWriteRateLimiter, authenticateConsumerOrSession, (req, res) =>
  decide(req, res, 'reject')
)

// ── GET /apps/:slug/publication — getAppPublication ──────────────────────────
router.get(
  '/apps/:slug/publication',
  buildReadRateLimiter,
  authenticateConsumerOrSession,
  async (req: any, res) => {
    try {
      const loaded = await loadAppForPublication(req, res)
      if (!loaded) return
      const { caller, app } = loaded
      if (!(await publishGate(res, { organizationId: app.organizationId, userId: caller.userId }))) return
      // Review notes/metadata are for the app's managers and platform admins;
      // anyone else who can merely READ the app gets 404 (never 403).
      if (!canMutate(app, caller)) return notFound(res, 'App not found')
      const pub = await appRegistryService.getPublication(app.slug)
      return res.json(toPublicationDto(app.slug, app.manifest.visibility ?? 'private', pub))
    } catch (err) {
      log.error('getAppPublication error', errInfo(err))
      return res.status(500).json({ error: 'internal_error', message: 'Failed to get publication' })
    }
  }
)

export { router }
export default router
