"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
// Versioned app-registry router — the FROZEN contract surface mounted at
// /api/v1/app-registry (services/app-registry-service/openapi.yaml). Mounted
// ALONGSIDE the legacy /api/apps router (which is kept for back-compat); this
// router supersedes it. operationIds implemented here 1:1 with the OpenAPI doc:
//   listApps, getApp, registerApp, updateApp, deleteApp,
//   activateApp, suspendApp, heartbeatApp.
const express_1 = __importDefault(require("express"));
const crypto_1 = require("crypto");
const auth_1 = require("../middleware/auth");
const manifest_schema_1 = require("../app-registry/manifest.schema");
const service_1 = require("../app-registry/service");
const caller_1 = require("../app-registry/caller");
const permit_1 = require("../app-registry/permit");
const events_1 = require("../app-registry/events");
const flags_1 = require("../app-registry/flags");
const router = express_1.default.Router();
exports.router = router;
function notFound(res) {
    return res.status(404).json({ error: 'not_found', message: 'App not found' });
}
function forbidden(res, message = 'Insufficient permissions for this object') {
    return res.status(403).json({ error: 'forbidden', message });
}
/**
 * release flag gate (default OFF) for the new write surface. When the flag is off
 * the write paths are dark — we 503 so the legacy /api/apps remains the path of
 * record until /api/v1/app-registry is deliberately released. Reads are never
 * gated. Fails safe (OFF) if the flag store is unreachable.
 */
async function v1WriteGate(caller, organizationId, res) {
    const enabled = await (0, flags_1.isV1WriteEnabled)({
        organizationId: organizationId ?? caller.organizationIds[0],
        userId: caller.userId,
    });
    if (!enabled) {
        res.status(503).json({
            error: 'feature_disabled',
            message: 'The app-registry write API is not yet enabled (fuzefront.app-registry.v1-registry-write)',
        });
        return false;
    }
    return true;
}
// ── GET /apps — listApps ──────────────────────────────────────────────────────
router.get('/apps', auth_1.authenticateToken, async (req, res) => {
    try {
        const caller = await (0, caller_1.resolveCaller)(req.user);
        const status = req.query.status;
        const mode = req.query.mode;
        const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
        const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
        if (status && !['registered', 'activated', 'suspended'].includes(status)) {
            return res
                .status(400)
                .json({ error: 'validation_error', message: 'invalid status filter' });
        }
        if (mode && !['portal', 'standalone'].includes(mode)) {
            return res
                .status(400)
                .json({ error: 'validation_error', message: 'invalid mode filter' });
        }
        if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
            return res
                .status(400)
                .json({ error: 'validation_error', message: 'invalid limit' });
        }
        const result = await service_1.appRegistryService.list({ status, mode, limit, cursor }, caller);
        return res.json(result);
    }
    catch (err) {
        console.error('[app-registry] listApps error:', err);
        return res.status(500).json({ error: 'internal_error', message: 'Failed to list apps' });
    }
});
// ── POST /apps — registerApp ──────────────────────────────────────────────────
router.post('/apps', auth_1.authenticateToken, async (req, res) => {
    try {
        const parsed = manifest_schema_1.registerAppRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json((0, manifest_schema_1.toValidationErrorBody)(parsed.error));
        }
        const { manifest, organizationId } = parsed.data;
        const orgId = organizationId ?? null;
        const caller = await (0, caller_1.resolveCaller)(req.user);
        // release flag (default OFF): the new write surface is dark until released.
        if (!(await v1WriteGate(caller, orgId, res)))
            return;
        // AuthZ: apps:register scoped to the target org (Permit). Object-level: a
        // non-admin caller may only register into an org they belong to.
        if (!caller.isPlatformAdmin) {
            if (orgId && !caller.organizationIds.includes(orgId)) {
                return forbidden(res, 'Cannot register an app into an organization you do not belong to');
            }
            if (!orgId) {
                return forbidden(res, 'Only platform admins may register platform-global apps');
            }
        }
        const permitted = await (0, permit_1.checkAppRegistryPermission)({
            userId: caller.userId,
            action: 'apps:register',
            organizationId: orgId,
            slug: manifest.slug,
        });
        if (!permitted && !caller.isPlatformAdmin) {
            return forbidden(res, 'Missing apps:register scope');
        }
        // Duplicate slug → 409.
        if (await service_1.appRegistryService.existsBySlug(manifest.slug)) {
            return res
                .status(409)
                .json({ error: 'conflict', message: 'An app with this slug already exists' });
        }
        const heartbeatToken = (0, crypto_1.randomBytes)(32).toString('hex');
        const app = await service_1.appRegistryService.register(manifest, orgId, heartbeatToken);
        // Kafka system-of-record event (fail-soft + ops-kill-switch, default ON).
        if (await (0, flags_1.isKafkaEmitEnabled)({ organizationId: orgId, userId: caller.userId })) {
            await (0, events_1.getAppRegistryEmitter)().appRegistered({
                slug: app.slug,
                name: app.manifest.name,
                mode: app.mode,
                integrationType: app.manifest.integration.type,
                builtin: app.builtin,
                organizationId: app.organizationId ?? undefined,
                registeredAt: app.createdAt,
            });
        }
        // Legacy live UI push (kept; Kafka is system-of-record).
        emitSocket(req, 'app-registered', { app, timestamp: new Date().toISOString() });
        // Return the heartbeat token in a header (out-of-band, not on the App shape).
        res.setHeader('X-App-Heartbeat-Token', heartbeatToken);
        return res.status(201).json(app);
    }
    catch (err) {
        // Unique-constraint race → 409.
        if (err?.code === '23505' || /duplicate key|unique/i.test(err?.message || '')) {
            return res
                .status(409)
                .json({ error: 'conflict', message: 'An app with this slug already exists' });
        }
        console.error('[app-registry] registerApp error:', err);
        return res.status(500).json({ error: 'internal_error', message: 'Failed to register app' });
    }
});
// ── GET /apps/:slug — getApp ──────────────────────────────────────────────────
router.get('/apps/:slug', auth_1.authenticateToken, async (req, res) => {
    try {
        const caller = await (0, caller_1.resolveCaller)(req.user);
        const app = await service_1.appRegistryService.findBySlug(req.params.slug);
        if (!app)
            return notFound(res);
        // BOLA: do not reveal existence of apps outside the caller's visibility → 404.
        if (!(0, service_1.canRead)(app, caller))
            return notFound(res);
        return res.json(app);
    }
    catch (err) {
        console.error('[app-registry] getApp error:', err);
        return res.status(500).json({ error: 'internal_error', message: 'Failed to get app' });
    }
});
// ── PUT /apps/:slug — updateApp ───────────────────────────────────────────────
router.put('/apps/:slug', auth_1.authenticateToken, async (req, res) => {
    try {
        const caller = await (0, caller_1.resolveCaller)(req.user);
        const existing = await service_1.appRegistryService.findBySlug(req.params.slug);
        if (!existing)
            return notFound(res);
        // BOLA: hide non-visible apps as 404; for visible-but-not-owned → handled below.
        if (!(0, service_1.canRead)(existing, caller))
            return notFound(res);
        if (!(await v1WriteGate(caller, existing.organizationId, res)))
            return;
        const parsed = manifest_schema_1.appManifestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json((0, manifest_schema_1.toValidationErrorBody)(parsed.error));
        }
        const manifest = parsed.data;
        // Immutable fields must match.
        const fields = [];
        if (manifest.slug !== existing.slug) {
            fields.push({ path: 'slug', message: 'slug is immutable' });
        }
        if (manifest.manifestVersion !== existing.manifest.manifestVersion) {
            fields.push({ path: 'manifestVersion', message: 'manifestVersion is immutable' });
        }
        if ((manifest.builtin ?? false) !== existing.builtin) {
            fields.push({ path: 'builtin', message: 'builtin is immutable' });
        }
        if (fields.length > 0) {
            return res.status(400).json({
                error: 'validation_error',
                message: 'immutable field mismatch',
                fields,
            });
        }
        // Object-level + Permit apps:write.
        if (!(0, service_1.canMutate)(existing, caller)) {
            return forbidden(res);
        }
        const permitted = await (0, permit_1.checkAppRegistryPermission)({
            userId: caller.userId,
            action: 'apps:write',
            organizationId: existing.organizationId,
            slug: existing.slug,
        });
        if (!permitted && !caller.isPlatformAdmin) {
            return forbidden(res, 'Missing apps:write scope');
        }
        const updated = await service_1.appRegistryService.updateManifest(existing, manifest);
        return res.json(updated);
    }
    catch (err) {
        console.error('[app-registry] updateApp error:', err);
        return res.status(500).json({ error: 'internal_error', message: 'Failed to update app' });
    }
});
// ── DELETE /apps/:slug — deleteApp ────────────────────────────────────────────
router.delete('/apps/:slug', auth_1.authenticateToken, async (req, res) => {
    try {
        const caller = await (0, caller_1.resolveCaller)(req.user);
        const existing = await service_1.appRegistryService.findBySlug(req.params.slug);
        if (!existing)
            return notFound(res);
        if (!(0, service_1.canRead)(existing, caller))
            return notFound(res);
        if (!(await v1WriteGate(caller, existing.organizationId, res)))
            return;
        // Built-ins cannot be deleted (only suspended) → 403.
        if (existing.builtin) {
            return forbidden(res, 'Built-in apps cannot be deleted (suspend instead)');
        }
        if (!(0, service_1.canMutate)(existing, caller)) {
            return forbidden(res);
        }
        const permitted = await (0, permit_1.checkAppRegistryPermission)({
            userId: caller.userId,
            action: 'apps:write',
            organizationId: existing.organizationId,
            slug: existing.slug,
        });
        if (!permitted && !caller.isPlatformAdmin) {
            return forbidden(res, 'Missing apps:write scope');
        }
        await service_1.appRegistryService.delete(existing.slug);
        return res.status(204).send();
    }
    catch (err) {
        console.error('[app-registry] deleteApp error:', err);
        return res.status(500).json({ error: 'internal_error', message: 'Failed to delete app' });
    }
});
// ── POST /apps/:slug/activate — activateApp ───────────────────────────────────
router.post('/apps/:slug/activate', auth_1.authenticateToken, (req, res) => transition(req, res, 'activated'));
// ── POST /apps/:slug/suspend — suspendApp ─────────────────────────────────────
router.post('/apps/:slug/suspend', auth_1.authenticateToken, (req, res) => transition(req, res, 'suspended'));
async function transition(req, res, target) {
    try {
        const caller = await (0, caller_1.resolveCaller)(req.user);
        const existing = await service_1.appRegistryService.findBySlug(req.params.slug);
        if (!existing)
            return notFound(res);
        if (!(0, service_1.canRead)(existing, caller))
            return notFound(res);
        if (!(await v1WriteGate(caller, existing.organizationId, res)))
            return res;
        if (!(0, service_1.canMutate)(existing, caller)) {
            return forbidden(res);
        }
        const permitted = await (0, permit_1.checkAppRegistryPermission)({
            userId: caller.userId,
            action: 'apps:activate',
            organizationId: existing.organizationId,
            slug: existing.slug,
        });
        if (!permitted && !caller.isPlatformAdmin) {
            return forbidden(res, 'Missing apps:activate scope');
        }
        // Validate the transition. The state machine is registered → activated →
        // suspended, but both activate and suspend are idempotent no-ops if already
        // in the target state, and an app may be re-activated from suspended.
        if (existing.status === target) {
            return res.json(existing); // idempotent no-op
        }
        const updated = await service_1.appRegistryService.setStatus(existing.slug, target);
        // ops-kill-switch (default ON): skip async event fan-out only if killed.
        if (await (0, flags_1.isKafkaEmitEnabled)({ organizationId: existing.organizationId, userId: caller.userId })) {
            const emitter = (0, events_1.getAppRegistryEmitter)();
            if (target === 'activated') {
                await emitter.appActivated({
                    slug: updated.slug,
                    organizationId: updated.organizationId ?? undefined,
                    actorUserId: caller.userId,
                    activatedAt: updated.updatedAt,
                });
            }
            else {
                await emitter.appSuspended({
                    slug: updated.slug,
                    organizationId: updated.organizationId ?? undefined,
                    actorUserId: caller.userId,
                    suspendedAt: updated.updatedAt,
                });
            }
        }
        emitSocket(req, 'app-status-changed', {
            appId: updated.slug,
            appName: updated.manifest.name,
            status: target,
            timestamp: new Date().toISOString(),
        });
        return res.json(updated);
    }
    catch (err) {
        console.error(`[app-registry] ${target} error:`, err);
        return res.status(500).json({ error: 'internal_error', message: `Failed to ${target} app` });
    }
}
// ── POST /apps/:slug/heartbeat — heartbeatApp ─────────────────────────────────
// Authenticated by a per-app heartbeat token (NOT a user session).
router.post('/apps/:slug/heartbeat', async (req, res) => {
    try {
        const parsed = manifest_schema_1.heartbeatRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json((0, manifest_schema_1.toValidationErrorBody)(parsed.error));
        }
        const { status, metadata } = parsed.data;
        const expectedToken = await service_1.appRegistryService.getHeartbeatToken(req.params.slug);
        // App must exist (have a registry row + token).
        const app = await service_1.appRegistryService.findBySlug(req.params.slug);
        if (!app || !expectedToken)
            return notFound(res);
        const header = req.headers['authorization'] || '';
        const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
        if (!presented || !safeEqual(presented, expectedToken)) {
            return res
                .status(401)
                .json({ error: 'unauthorized', message: 'Invalid app heartbeat token' });
        }
        const at = new Date();
        const healthy = status === 'online';
        await service_1.appRegistryService.recordHeartbeat(app.slug, healthy, at);
        // ops-kill-switch (default ON). No user session here (token-auth), so the
        // flag context carries the app's org only.
        if (await (0, flags_1.isKafkaEmitEnabled)({ organizationId: app.organizationId })) {
            await (0, events_1.getAppRegistryEmitter)().appHeartbeat({
                slug: app.slug,
                status,
                metadata,
                seenAt: at.toISOString(),
            });
        }
        emitSocket(req, 'app-status-changed', {
            appId: app.slug,
            appName: app.manifest.name,
            status,
            isHealthy: healthy,
            timestamp: at.toISOString(),
            metadata,
        });
        return res.json({ accepted: true, at: at.toISOString() });
    }
    catch (err) {
        console.error('[app-registry] heartbeat error:', err);
        return res.status(500).json({ error: 'internal_error', message: 'Failed to process heartbeat' });
    }
});
function emitSocket(req, event, payload) {
    try {
        const io = req.app.get('io');
        if (io)
            io.emit(event, payload);
    }
    catch {
        /* live push is best-effort */
    }
}
/** Constant-time-ish token comparison. */
function safeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
exports.default = router;
//# sourceMappingURL=app-registry.js.map