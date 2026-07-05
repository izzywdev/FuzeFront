"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orgTokensRouter = void 0;
exports.requireTokenScope = requireTokenScope;
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
const express_1 = __importDefault(require("express"));
const database_1 = require("../config/database");
const api_token_auth_1 = require("../middleware/api-token-auth");
const api_token_1 = require("../services/api-token");
const permission_check_1 = require("../utils/permit/permission-check");
const user_sync_1 = require("../utils/permit/user-sync");
const schema_1 = require("../permit/schema");
// ---------------------------------------------------------------------------
// Known scopes — derived from permitSchema (ResourceKey:action)
// ---------------------------------------------------------------------------
const KNOWN_SCOPES = new Set(schema_1.permitSchema.resources.flatMap(resource => Object.keys(resource.actions).map(action => `${resource.key}:${action}`)));
// ---------------------------------------------------------------------------
// Membership helper — checks if userId is owner or admin of orgId
// ---------------------------------------------------------------------------
async function isOrgAdminOrOwner(userId, orgId) {
    const membership = await database_1.db('organization_memberships')
        .where('user_id', userId)
        .where('organization_id', orgId)
        .where('status', 'active')
        .whereIn('role', ['owner', 'admin'])
        .first();
    return !!membership;
}
// ---------------------------------------------------------------------------
// Scope-enforcement middleware (exported for per-route use elsewhere)
// ---------------------------------------------------------------------------
/**
 * requireTokenScope(scope) — Express middleware.
 *
 * If the request was authenticated via API token (req.apiToken set), the token
 * MUST include `scope`; if it does not, respond 403.
 * If the request was authenticated via JWT (req.apiToken not set), this is a
 * no-op: JWT users are not scope-limited.
 */
function requireTokenScope(scope) {
    return (req, res, next) => {
        if (req.apiToken) {
            if (!req.apiToken.scopes.includes(scope)) {
                res.status(403).json({ error: 'Scope not granted by token' });
                return;
            }
        }
        next();
    };
}
// ---------------------------------------------------------------------------
// Main tokens router (mounted at /api/tokens)
// ---------------------------------------------------------------------------
const router = express_1.default.Router();
/**
 * @swagger
 * /api/tokens:
 *   post:
 *     summary: Create a new API token (PAT or service token)
 *     tags: [APITokens]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, owner_type, owner_id, scopes]
 *             properties:
 *               name: { type: string }
 *               owner_type: { type: string, enum: [user, org] }
 *               owner_id: { type: string }
 *               scopes: { type: array, items: { type: string } }
 *               expires_at: { type: string, format: date-time, nullable: true }
 *               org_id: { type: string, description: "Optional: org context for PAT scope check" }
 *     responses:
 *       201:
 *         description: Token created; raw token shown once
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 */
router.post('/', api_token_auth_1.authenticateFlexible, async (req, res) => {
    try {
        const { name, owner_type, owner_id, scopes, expires_at, org_id } = req.body;
        // Basic validation
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'name is required and must be a non-empty string' });
        }
        if (!owner_type || !['user', 'org'].includes(owner_type)) {
            return res.status(400).json({ error: 'owner_type must be "user" or "org"' });
        }
        if (!owner_id || typeof owner_id !== 'string' || owner_id.trim().length === 0) {
            return res.status(400).json({ error: 'owner_id is required' });
        }
        if (!Array.isArray(scopes)) {
            return res.status(400).json({ error: 'scopes must be an array of strings' });
        }
        if (expires_at !== undefined && expires_at !== null) {
            const d = new Date(expires_at);
            if (isNaN(d.getTime())) {
                return res.status(400).json({ error: 'expires_at must be a parseable date string or null' });
            }
        }
        // Validate all requested scopes are known
        const unknownScopes = scopes.filter(s => !KNOWN_SCOPES.has(s));
        if (unknownScopes.length > 0) {
            return res.status(400).json({ error: `Unknown scope strings: ${unknownScopes.join(', ')}` });
        }
        if (owner_type === 'user') {
            // PAT: owner_id MUST be the requesting user
            if (owner_id !== req.user.id) {
                return res.status(403).json({ error: 'You can only create tokens for yourself' });
            }
            // Optional per-org Permit scope check: if org_id provided, verify user holds those permissions
            if (org_id) {
                const permissions = await (0, permission_check_1.getUserPermissions)(req.user.id, org_id);
                // getUserPermissions returns an object; collect all permission strings across resources
                const userScopeSet = new Set();
                if (permissions && typeof permissions === 'object') {
                    for (const [tenantKey, tenantPerms] of Object.entries(permissions)) {
                        if (tenantKey === org_id && tenantPerms && typeof tenantPerms === 'object') {
                            for (const [resourceKey, actions] of Object.entries(tenantPerms)) {
                                if (Array.isArray(actions)) {
                                    for (const action of actions) {
                                        userScopeSet.add(`${resourceKey}:${action}`);
                                    }
                                }
                            }
                        }
                    }
                }
                const notGranted = scopes.filter(s => !userScopeSet.has(s));
                if (notGranted.length > 0) {
                    return res.status(403).json({
                        error: `Requested scopes exceed your permissions in org ${org_id}: ${notGranted.join(', ')}`,
                    });
                }
            }
            // If org_id is omitted, scopes are already validated as known scope strings (above)
        }
        else {
            // org token: caller must be owner/admin of the org
            const isAdmin = await isOrgAdminOrOwner(req.user.id, owner_id);
            if (!isAdmin) {
                return res.status(403).json({ error: 'Insufficient permissions: must be org owner or admin' });
            }
        }
        const created = await (0, api_token_1.createToken)({
            name: name.trim(),
            ownerType: owner_type,
            ownerId: owner_id,
            scopes: scopes,
            expiresAt: expires_at ? new Date(expires_at) : null,
            createdBy: req.user.id,
        });
        // For org tokens: sync to Permit (non-fatal)
        if (owner_type === 'org') {
            (0, user_sync_1.syncServiceTokenToPermit)(created.id, owner_id, (0, api_token_1.mapScopesToPermitRole)(scopes))
                .then(ok => { if (!ok)
                console.warn('[api-tokens] syncServiceTokenToPermit returned false for token', created.id); })
                .catch(err => console.error('[api-tokens] syncServiceTokenToPermit threw (non-fatal):', err));
        }
        // Return 201 with raw token ONCE — never returned again
        return res.status(201).json({
            id: created.id,
            token: created.token,
            token_prefix: created.token_prefix,
            name: created.name,
            scopes: created.scopes,
            expires_at: created.expires_at,
            created_at: created.created_at,
        });
    }
    catch (error) {
        console.error('Error creating token:', error);
        return res.status(500).json({ error: 'Failed to create token' });
    }
});
/**
 * @swagger
 * /api/tokens:
 *   get:
 *     summary: List caller's PATs
 *     tags: [APITokens]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of token metadata (no token/token_hash fields)
 */
router.get('/', api_token_auth_1.authenticateFlexible, async (req, res) => {
    try {
        const tokens = await (0, api_token_1.listTokensForOwner)('user', req.user.id);
        // Ensure raw token and token_hash are never included (service excludes token_hash; no 'token' field in rows)
        const safe = tokens.map(({ ...t }) => {
            delete t.token;
            delete t.token_hash;
            return t;
        });
        return res.json({ tokens: safe });
    }
    catch (error) {
        console.error('Error listing tokens:', error);
        return res.status(500).json({ error: 'Failed to list tokens' });
    }
});
/**
 * @swagger
 * /api/tokens/{tokenId}:
 *   get:
 *     summary: Get token metadata by ID
 *     tags: [APITokens]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Token metadata (no token/token_hash)
 *       403:
 *         description: Forbidden (token belongs to another user/org)
 *       404:
 *         description: Token not found
 */
router.get('/:tokenId', api_token_auth_1.authenticateFlexible, async (req, res) => {
    try {
        const { tokenId } = req.params;
        const token = await (0, api_token_1.getTokenById)(tokenId);
        if (!token) {
            return res.status(404).json({ error: 'Token not found' });
        }
        if (token.owner_type === 'user') {
            if (token.owner_id !== req.user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }
        else {
            // org token: caller must be owner/admin
            const isAdmin = await isOrgAdminOrOwner(req.user.id, token.owner_id);
            if (!isAdmin) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }
        // Defensive: strip token_hash (should never be there, but guard anyway)
        const { token_hash: _omit, token: _rawOmit, ...safe } = token;
        return res.json(safe);
    }
    catch (error) {
        console.error('Error fetching token:', error);
        return res.status(500).json({ error: 'Failed to fetch token' });
    }
});
/**
 * @swagger
 * /api/tokens/{tokenId}:
 *   delete:
 *     summary: Revoke a token
 *     tags: [APITokens]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Token revoked
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Token not found
 */
router.delete('/:tokenId', api_token_auth_1.authenticateFlexible, async (req, res) => {
    try {
        const { tokenId } = req.params;
        const token = await (0, api_token_1.getTokenById)(tokenId);
        if (!token) {
            return res.status(404).json({ error: 'Token not found' });
        }
        if (token.owner_type === 'user') {
            if (token.owner_id !== req.user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }
        else {
            const isAdmin = await isOrgAdminOrOwner(req.user.id, token.owner_id);
            if (!isAdmin) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }
        await (0, api_token_1.revokeToken)(tokenId);
        // For org service tokens: remove Permit role (non-fatal)
        if (token.owner_type === 'org') {
            (0, user_sync_1.removeServiceTokenFromPermit)(tokenId, token.owner_id, (0, api_token_1.mapScopesToPermitRole)(token.scopes))
                .then(ok => { if (!ok)
                console.warn('[api-tokens] removeServiceTokenFromPermit returned false for token', tokenId); })
                .catch(err => console.error('[api-tokens] removeServiceTokenFromPermit threw (non-fatal):', err));
        }
        return res.status(200).json({ message: 'Token revoked' });
    }
    catch (error) {
        console.error('Error revoking token:', error);
        return res.status(500).json({ error: 'Failed to revoke token' });
    }
});
// ---------------------------------------------------------------------------
// Org-tokens sub-router (mounted at /api/organizations in index.ts)
// GET /api/organizations/:orgId/tokens
// ---------------------------------------------------------------------------
exports.orgTokensRouter = express_1.default.Router();
/**
 * @swagger
 * /api/organizations/{orgId}/tokens:
 *   get:
 *     summary: List service tokens for an organization
 *     tags: [APITokens]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Array of org service token metadata
 *       403:
 *         description: Forbidden
 */
exports.orgTokensRouter.get('/:orgId/tokens', api_token_auth_1.authenticateFlexible, async (req, res) => {
    try {
        const { orgId } = req.params;
        const isAdmin = await isOrgAdminOrOwner(req.user.id, orgId);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Insufficient permissions: must be org owner or admin' });
        }
        const tokens = await (0, api_token_1.listTokensForOwner)('org', orgId);
        const safe = tokens.map(({ ...t }) => {
            delete t.token;
            delete t.token_hash;
            return t;
        });
        return res.json({ tokens: safe });
    }
    catch (error) {
        console.error('Error listing org tokens:', error);
        return res.status(500).json({ error: 'Failed to list org tokens' });
    }
});
exports.default = router;
//# sourceMappingURL=api-tokens.js.map