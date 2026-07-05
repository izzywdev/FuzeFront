"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appRegistryService = exports.AppRegistryService = void 0;
exports.canRead = canRead;
exports.canMutate = canMutate;
// app-registry data/service layer over the `apps` table. Maps DB rows to the
// FROZEN `App` contract shape (services/app-registry-service/openapi.yaml), owns
// the lifecycle state machine, BOLA-safe visibility filtering, and opaque cursor
// pagination. No HTTP concerns here — routes call into this.
const database_1 = require("../config/database");
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
function rowToApp(row) {
    const manifest = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest;
    return {
        slug: row.slug,
        status: row.status,
        mode: row.mode,
        builtin: Boolean(row.builtin),
        organizationId: row.organization_id ?? null,
        manifest,
        isHealthy: row.is_healthy === null || row.is_healthy === undefined ? null : Boolean(row.is_healthy),
        lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    };
}
/**
 * Visibility / BOLA predicate. A caller may READ an app when:
 *  - they are a platform admin (sees all), OR
 *  - visibility is public|marketplace (everyone), OR
 *  - visibility is organization AND the app's org is one the caller belongs to, OR
 *  - visibility is private AND the app's org is one the caller belongs to (owner org).
 * An org-less (platform-global) app is treated as public for read.
 */
function canRead(app, caller) {
    if (caller.isPlatformAdmin)
        return true;
    const visibility = app.manifest.visibility ?? 'private';
    if (visibility === 'public' || visibility === 'marketplace')
        return true;
    if (!app.organizationId)
        return true; // platform-global → readable
    const inOrg = caller.organizationIds.includes(app.organizationId);
    if (visibility === 'organization' || visibility === 'private')
        return inOrg;
    return false;
}
/**
 * Mutation/object-level predicate. A caller may MUTATE (write/activate/suspend)
 * an app only when they are a platform admin OR a member of the app's owning org.
 * Org-less apps are platform-admin-only to mutate.
 */
function canMutate(app, caller) {
    if (caller.isPlatformAdmin)
        return true;
    if (!app.organizationId)
        return false;
    return caller.organizationIds.includes(app.organizationId);
}
function encodeCursor(row) {
    const createdAt = new Date(row.created_at).toISOString();
    return Buffer.from(`${createdAt}|${row.slug}`, 'utf8').toString('base64url');
}
function decodeCursor(cursor) {
    try {
        const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
        const idx = decoded.indexOf('|');
        if (idx < 0)
            return null;
        return { createdAt: decoded.slice(0, idx), slug: decoded.slice(idx + 1) };
    }
    catch {
        return null;
    }
}
class AppRegistryService {
    /**
     * BOLA-safe, paginated list. Visibility filtering is applied IN SQL so a caller
     * never receives an app outside their org. Keyset pagination on (created_at, slug)
     * keeps the page bounded. Only manifest-bearing (registry) rows are returned.
     */
    async list(params, caller) {
        const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
        let query = (0, database_1.db)('apps').whereNotNull('slug').whereNotNull('manifest');
        if (params.status) {
            query = query.where('status', params.status);
        }
        else {
            // Default: hide suspended apps (per the contract's "all non-suspended").
            query = query.whereNot('status', 'suspended');
        }
        if (params.mode) {
            query = query.where('mode', params.mode);
        }
        // BOLA filter in SQL (unless platform admin).
        if (!caller.isPlatformAdmin) {
            const orgIds = caller.organizationIds;
            query = query.where(builder => {
                builder
                    .whereIn('visibility', ['public', 'marketplace'])
                    .orWhereNull('organization_id');
                if (orgIds.length > 0) {
                    builder.orWhere(sub => {
                        sub
                            .whereIn('visibility', ['organization', 'private'])
                            .whereIn('organization_id', orgIds);
                    });
                }
            });
        }
        // Keyset cursor.
        if (params.cursor) {
            const decoded = decodeCursor(params.cursor);
            if (decoded) {
                query = query.where(builder => {
                    builder
                        .where('created_at', '>', decoded.createdAt)
                        .orWhere(sub => {
                        sub
                            .where('created_at', '=', decoded.createdAt)
                            .andWhere('slug', '>', decoded.slug);
                    });
                });
            }
        }
        const rows = await query
            .orderBy('created_at', 'asc')
            .orderBy('slug', 'asc')
            .limit(limit + 1);
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;
        return { apps: page.map(rowToApp), nextCursor };
    }
    /** Raw row fetch by slug (registry rows only). */
    async findBySlug(slug) {
        const row = await (0, database_1.db)('apps').where('slug', slug).whereNotNull('manifest').first();
        return row ? rowToApp(row) : null;
    }
    /** Fetch the raw heartbeat token for a slug (not exposed on the App shape). */
    async getHeartbeatToken(slug) {
        const row = await (0, database_1.db)('apps').where('slug', slug).first();
        return row?.heartbeat_token ?? null;
    }
    async existsBySlug(slug) {
        const row = await (0, database_1.db)('apps').where('slug', slug).first();
        return Boolean(row);
    }
    /**
     * Registers a new app from a validated manifest. Starts in `registered`.
     * Returns the created App + the generated heartbeat token (token is returned
     * to the caller out-of-band, never embedded in the App shape).
     */
    async register(manifest, organizationId, heartbeatToken) {
        const now = new Date();
        const integrationUrl = manifest.integration.url || manifest.integration.remoteEntry || '';
        const insert = {
            slug: manifest.slug,
            name: manifest.name,
            url: integrationUrl,
            icon_url: manifest.icon?.kind === 'url' ? manifest.icon.value : null,
            description: manifest.description ?? null,
            integration_type: manifest.integration.type,
            remote_url: manifest.integration.remoteEntry ?? null,
            scope: manifest.integration.scope ?? null,
            module: manifest.integration.module ?? null,
            manifest: JSON.stringify(manifest),
            status: 'registered',
            mode: manifest.mode,
            builtin: manifest.builtin ?? false,
            organization_id: organizationId,
            visibility: (manifest.visibility ?? 'private'),
            is_active: false,
            heartbeat_token: heartbeatToken,
            created_at: now,
            updated_at: now,
        };
        await (0, database_1.db)('apps').insert(insert);
        const created = await this.findBySlug(manifest.slug);
        if (!created)
            throw new Error('register: row not found after insert');
        return created;
    }
    /**
     * Replaces an existing app's manifest. slug/builtin/manifestVersion are
     * immutable; callers must pass a manifest whose slug matches. Status/org are
     * preserved.
     */
    async updateManifest(existing, manifest) {
        const integrationUrl = manifest.integration.url || manifest.integration.remoteEntry || '';
        await (0, database_1.db)('apps')
            .where('slug', existing.slug)
            .update({
            name: manifest.name,
            url: integrationUrl,
            icon_url: manifest.icon?.kind === 'url' ? manifest.icon.value : null,
            description: manifest.description ?? null,
            integration_type: manifest.integration.type,
            remote_url: manifest.integration.remoteEntry ?? null,
            scope: manifest.integration.scope ?? null,
            module: manifest.integration.module ?? null,
            manifest: JSON.stringify(manifest),
            mode: manifest.mode,
            visibility: (manifest.visibility ?? existing.manifest.visibility ?? 'private'),
            updated_at: new Date(),
        });
        const updated = await this.findBySlug(existing.slug);
        if (!updated)
            throw new Error('updateManifest: row not found after update');
        return updated;
    }
    async delete(slug) {
        await (0, database_1.db)('apps').where('slug', slug).del();
    }
    /** Idempotent transition to `activated`. */
    async setStatus(slug, status) {
        await (0, database_1.db)('apps')
            .where('slug', slug)
            .update({
            status,
            // keep legacy is_active in sync so the old /api/apps surface agrees.
            is_active: status === 'activated',
            updated_at: new Date(),
        });
        const updated = await this.findBySlug(slug);
        if (!updated)
            throw new Error('setStatus: row not found after update');
        return updated;
    }
    /** Records a heartbeat — updates last_seen_at + is_healthy. */
    async recordHeartbeat(slug, healthy, at) {
        await (0, database_1.db)('apps').where('slug', slug).update({
            last_seen_at: at,
            is_healthy: healthy,
            updated_at: at,
        });
    }
    /**
     * Idempotent upsert by slug for the built-in seed loader. Inserts if absent;
     * if present (by slug) it is left untouched so we never clobber operator state.
     */
    async upsertBuiltin(manifest, status, heartbeatToken) {
        const existing = await (0, database_1.db)('apps').where('slug', manifest.slug).first();
        if (existing)
            return;
        const now = new Date();
        const integrationUrl = manifest.integration.url || manifest.integration.remoteEntry || '';
        await (0, database_1.db)('apps')
            .insert({
            slug: manifest.slug,
            name: manifest.name,
            url: integrationUrl,
            icon_url: manifest.icon?.kind === 'url' ? manifest.icon.value : null,
            description: manifest.description ?? null,
            integration_type: manifest.integration.type,
            remote_url: manifest.integration.remoteEntry ?? null,
            scope: manifest.integration.scope ?? null,
            module: manifest.integration.module ?? null,
            manifest: JSON.stringify(manifest),
            status,
            mode: manifest.mode,
            builtin: true,
            organization_id: null,
            visibility: (manifest.visibility ?? 'public'),
            is_active: status === 'activated',
            heartbeat_token: heartbeatToken,
            created_at: now,
            updated_at: now,
        })
            .onConflict('slug')
            .ignore();
    }
}
exports.AppRegistryService = AppRegistryService;
exports.appRegistryService = new AppRegistryService();
//# sourceMappingURL=service.js.map