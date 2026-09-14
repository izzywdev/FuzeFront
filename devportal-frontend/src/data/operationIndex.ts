/**
 * Best-effort operationId -> {repo, service} resolver for the home page's
 * "your recent specs" panel (frame 02).
 *
 * BACKEND GAP (flagged for backend-engineer, not fixed here — out of this
 * PR's scope, which is UI-only): `PlaygroundCall` (services/devportal-service/
 * openapi.yaml) carries `operation_id`/`method`/`path` but no `specId`/`repo`/
 * `service` — so the frontend cannot reliably turn a logged sandbox call back
 * into "which spec was this against" without re-deriving it. A future
 * `PlaygroundCall.repo`/`service` (or `specId`, resolved against the catalog)
 * would let RecentSpecsPanel drop this table entirely. Until then this is a
 * small, explicitly-labelled fallback: known operationIds resolve exactly;
 * anything else falls back to a readable label built from the call's own
 * `path` (see home/DevPortalHomeFlow.tsx's `describeCall`).
 */
export const OPERATION_INDEX: Record<string, { repo: string; service: string }> = {
  registerApp: { repo: 'fuzefront', service: 'app-registry-service' },
}
