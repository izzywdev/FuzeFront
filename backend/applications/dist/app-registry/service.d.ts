import { AppManifest, AppMode, AppStatus } from './manifest.schema';
/** The App contract shape returned by the API (matches openapi App schema). */
export interface AppRecord {
    slug: string;
    status: AppStatus;
    mode: AppMode;
    builtin: boolean;
    organizationId: string | null;
    manifest: AppManifest;
    isHealthy: boolean | null;
    lastSeenAt: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface AppCaller {
    userId: string;
    /** Org memberships of the caller (org ids). Used for `organization` visibility. */
    organizationIds: string[];
    roles: string[];
    isPlatformAdmin: boolean;
}
/**
 * Visibility / BOLA predicate. A caller may READ an app when:
 *  - they are a platform admin (sees all), OR
 *  - visibility is public|marketplace (everyone), OR
 *  - visibility is organization AND the app's org is one the caller belongs to, OR
 *  - visibility is private AND the app's org is one the caller belongs to (owner org).
 * An org-less (platform-global) app is treated as public for read.
 */
export declare function canRead(app: AppRecord, caller: AppCaller): boolean;
/**
 * Mutation/object-level predicate. A caller may MUTATE (write/activate/suspend)
 * an app only when they are a platform admin OR a member of the app's owning org.
 * Org-less apps are platform-admin-only to mutate.
 */
export declare function canMutate(app: AppRecord, caller: AppCaller): boolean;
export interface ListParams {
    status?: AppStatus;
    mode?: AppMode;
    limit?: number;
    cursor?: string;
}
export interface ListResult {
    apps: AppRecord[];
    nextCursor: string | null;
}
export declare class AppRegistryService {
    /**
     * BOLA-safe, paginated list. Visibility filtering is applied IN SQL so a caller
     * never receives an app outside their org. Keyset pagination on (created_at, slug)
     * keeps the page bounded. Only manifest-bearing (registry) rows are returned.
     */
    list(params: ListParams, caller: AppCaller): Promise<ListResult>;
    /** Raw row fetch by slug (registry rows only). */
    findBySlug(slug: string): Promise<AppRecord | null>;
    /** Fetch the raw heartbeat token for a slug (not exposed on the App shape). */
    getHeartbeatToken(slug: string): Promise<string | null>;
    existsBySlug(slug: string): Promise<boolean>;
    /**
     * Registers a new app from a validated manifest. Starts in `registered`.
     * Returns the created App + the generated heartbeat token (token is returned
     * to the caller out-of-band, never embedded in the App shape).
     */
    register(manifest: AppManifest, organizationId: string | null, heartbeatToken: string): Promise<AppRecord>;
    /**
     * Replaces an existing app's manifest. slug/builtin/manifestVersion are
     * immutable; callers must pass a manifest whose slug matches. Status/org are
     * preserved.
     */
    updateManifest(existing: AppRecord, manifest: AppManifest): Promise<AppRecord>;
    delete(slug: string): Promise<void>;
    /** Idempotent transition to `activated`. */
    setStatus(slug: string, status: AppStatus): Promise<AppRecord>;
    /** Records a heartbeat — updates last_seen_at + is_healthy. */
    recordHeartbeat(slug: string, healthy: boolean, at: Date): Promise<void>;
    /**
     * Idempotent upsert by slug for the built-in seed loader. Inserts if absent;
     * if present (by slug) it is left untouched so we never clobber operator state.
     */
    upsertBuiltin(manifest: AppManifest, status: AppStatus, heartbeatToken: string): Promise<void>;
}
export declare const appRegistryService: AppRegistryService;
//# sourceMappingURL=service.d.ts.map