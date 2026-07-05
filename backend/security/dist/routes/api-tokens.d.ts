/**
 * api-tokens.ts — API token management routes.
 *
 * Mounted at:
 *   /api/tokens         — PAT + org-token CRUD
 *   /api/organizations  — org-token sub-route (GET /:orgId/tokens)
 *
 * Org-tokens sub-route approach:
 *   The GET /api/organizations/:orgId/tokens route is registered on a SECOND
 *   router exported as `orgTokensRouter` and mounted at `/api/organizations`
 *   in index.ts.  This avoids touching the large organizations.ts file while
 *   keeping path semantics correct.
 *
 * PAT scope-subset check rule (documented choice):
 *   When creating a PAT (owner_type === 'user'), the requested scopes are
 *   validated to be a subset of the KNOWN scope strings from permitSchema.
 *   If an optional `org_id` is provided in the body, we ALSO verify via
 *   getUserPermissions that the requesting user has those permissions in that org.
 *   If `org_id` is omitted, we skip the per-org Permit check and ONLY validate
 *   that all requested scopes are known valid scope strings.
 *
 * Cross-user token access (documented choice):
 *   GET /api/tokens/:tokenId and DELETE /api/tokens/:tokenId return 403 (not 404)
 *   when the token exists but belongs to a different user/org. This makes the
 *   ownership boundary explicit rather than hiding it as "not found".
 *
 * Revoke response: 200 { message: 'Token revoked' }.
 */
import { Response, NextFunction } from 'express';
/**
 * requireTokenScope(scope) — Express middleware.
 *
 * If the request was authenticated via API token (req.apiToken set), the token
 * MUST include `scope`; if it does not, respond 403.
 * If the request was authenticated via JWT (req.apiToken not set), this is a
 * no-op: JWT users are not scope-limited.
 */
export declare function requireTokenScope(scope: string): (req: any, res: Response, next: NextFunction) => void;
declare const router: any;
export declare const orgTokensRouter: any;
export default router;
//# sourceMappingURL=api-tokens.d.ts.map