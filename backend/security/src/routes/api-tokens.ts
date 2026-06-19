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
import express, { Request, Response, NextFunction } from 'express'
import { db } from '../config/database'
import { authenticateFlexible } from '../middleware/api-token-auth'
import {
  createToken,
  listTokensForOwner,
  getTokenById,
  revokeToken,
  mapScopesToPermitRole,
} from '../services/api-token'
import { getUserPermissions } from '../utils/permit/permission-check'
import { syncServiceTokenToPermit, removeServiceTokenFromPermit } from '../utils/permit/user-sync'
import { permitSchema } from '../permit/schema'

// ---------------------------------------------------------------------------
// Known scopes — derived from permitSchema (ResourceKey:action)
// ---------------------------------------------------------------------------

const KNOWN_SCOPES: Set<string> = new Set(
  permitSchema.resources.flatMap(resource =>
    Object.keys(resource.actions).map(action => `${resource.key}:${action}`)
  )
)

// ---------------------------------------------------------------------------
// Membership helper — checks if userId is owner or admin of orgId
// ---------------------------------------------------------------------------

async function isOrgAdminOrOwner(userId: string, orgId: string): Promise<boolean> {
  const membership = await (db as any)('organization_memberships')
    .where('user_id', userId)
    .where('organization_id', orgId)
    .where('status', 'active')
    .whereIn('role', ['owner', 'admin'])
    .first()
  return !!membership
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
export function requireTokenScope(scope: string) {
  return (req: any, res: Response, next: NextFunction): void => {
    if (req.apiToken) {
      if (!req.apiToken.scopes.includes(scope)) {
        res.status(403).json({ error: 'Scope not granted by token' })
        return
      }
    }
    next()
  }
}

// ---------------------------------------------------------------------------
// Main tokens router (mounted at /api/tokens)
// ---------------------------------------------------------------------------

const router = express.Router()

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
router.post('/', authenticateFlexible, async (req: any, res: Response) => {
  try {
    const { name, owner_type, owner_id, scopes, expires_at, org_id } = req.body

    // Basic validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required and must be a non-empty string' })
    }
    if (!owner_type || !['user', 'org'].includes(owner_type)) {
      return res.status(400).json({ error: 'owner_type must be "user" or "org"' })
    }
    if (!owner_id || typeof owner_id !== 'string' || owner_id.trim().length === 0) {
      return res.status(400).json({ error: 'owner_id is required' })
    }
    if (!Array.isArray(scopes)) {
      return res.status(400).json({ error: 'scopes must be an array of strings' })
    }
    if (expires_at !== undefined && expires_at !== null) {
      const d = new Date(expires_at)
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: 'expires_at must be a parseable date string or null' })
      }
    }

    // Validate all requested scopes are known
    const unknownScopes = (scopes as string[]).filter(s => !KNOWN_SCOPES.has(s))
    if (unknownScopes.length > 0) {
      return res.status(400).json({ error: `Unknown scope strings: ${unknownScopes.join(', ')}` })
    }

    if (owner_type === 'user') {
      // PAT: owner_id MUST be the requesting user
      if (owner_id !== req.user.id) {
        return res.status(403).json({ error: 'You can only create tokens for yourself' })
      }

      // Optional per-org Permit scope check: if org_id provided, verify user holds those permissions
      if (org_id) {
        const permissions = await getUserPermissions(req.user.id, org_id)
        // getUserPermissions returns an object; collect all permission strings across resources
        const userScopeSet: Set<string> = new Set()
        if (permissions && typeof permissions === 'object') {
          for (const [tenantKey, tenantPerms] of Object.entries(permissions as Record<string, any>)) {
            if (tenantKey === org_id && tenantPerms && typeof tenantPerms === 'object') {
              for (const [resourceKey, actions] of Object.entries(tenantPerms as Record<string, any>)) {
                if (Array.isArray(actions)) {
                  for (const action of actions) {
                    userScopeSet.add(`${resourceKey}:${action}`)
                  }
                }
              }
            }
          }
        }
        const notGranted = (scopes as string[]).filter(s => !userScopeSet.has(s))
        if (notGranted.length > 0) {
          return res.status(403).json({
            error: `Requested scopes exceed your permissions in org ${org_id}: ${notGranted.join(', ')}`,
          })
        }
      }
      // If org_id is omitted, scopes are already validated as known scope strings (above)
    } else {
      // org token: caller must be owner/admin of the org
      const isAdmin = await isOrgAdminOrOwner(req.user.id, owner_id)
      if (!isAdmin) {
        return res.status(403).json({ error: 'Insufficient permissions: must be org owner or admin' })
      }
    }

    const created = await createToken({
      name: name.trim(),
      ownerType: owner_type,
      ownerId: owner_id,
      scopes: scopes as string[],
      expiresAt: expires_at ? new Date(expires_at) : null,
      createdBy: req.user.id,
    })

    // For org tokens: sync to Permit (non-fatal)
    if (owner_type === 'org') {
      syncServiceTokenToPermit(created.id, owner_id, mapScopesToPermitRole(scopes as string[]))
        .then(ok => { if (!ok) console.warn('[api-tokens] syncServiceTokenToPermit returned false for token', created.id) })
        .catch(err => console.error('[api-tokens] syncServiceTokenToPermit threw (non-fatal):', err))
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
    })
  } catch (error: any) {
    console.error('Error creating token:', error)
    return res.status(500).json({ error: 'Failed to create token' })
  }
})

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
router.get('/', authenticateFlexible, async (req: any, res: Response) => {
  try {
    const tokens = await listTokensForOwner('user', req.user.id)
    // Ensure raw token and token_hash are never included (service excludes token_hash; no 'token' field in rows)
    const safe = tokens.map(({ ...t }: any) => {
      delete t.token
      delete t.token_hash
      return t
    })
    return res.json({ tokens: safe })
  } catch (error: any) {
    console.error('Error listing tokens:', error)
    return res.status(500).json({ error: 'Failed to list tokens' })
  }
})

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
router.get('/:tokenId', authenticateFlexible, async (req: any, res: Response) => {
  try {
    const { tokenId } = req.params
    const token = await getTokenById(tokenId)
    if (!token) {
      return res.status(404).json({ error: 'Token not found' })
    }

    if (token.owner_type === 'user') {
      if (token.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' })
      }
    } else {
      // org token: caller must be owner/admin
      const isAdmin = await isOrgAdminOrOwner(req.user.id, token.owner_id)
      if (!isAdmin) {
        return res.status(403).json({ error: 'Access denied' })
      }
    }

    // Defensive: strip token_hash (should never be there, but guard anyway)
    const { token_hash: _omit, token: _rawOmit, ...safe } = token as any
    return res.json(safe)
  } catch (error: any) {
    console.error('Error fetching token:', error)
    return res.status(500).json({ error: 'Failed to fetch token' })
  }
})

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
router.delete('/:tokenId', authenticateFlexible, async (req: any, res: Response) => {
  try {
    const { tokenId } = req.params
    const token = await getTokenById(tokenId)
    if (!token) {
      return res.status(404).json({ error: 'Token not found' })
    }

    if (token.owner_type === 'user') {
      if (token.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' })
      }
    } else {
      const isAdmin = await isOrgAdminOrOwner(req.user.id, token.owner_id)
      if (!isAdmin) {
        return res.status(403).json({ error: 'Access denied' })
      }
    }

    await revokeToken(tokenId)

    // For org service tokens: remove Permit role (non-fatal)
    if (token.owner_type === 'org') {
      removeServiceTokenFromPermit(tokenId, token.owner_id, mapScopesToPermitRole(token.scopes))
        .then(ok => { if (!ok) console.warn('[api-tokens] removeServiceTokenFromPermit returned false for token', tokenId) })
        .catch(err => console.error('[api-tokens] removeServiceTokenFromPermit threw (non-fatal):', err))
    }

    return res.status(200).json({ message: 'Token revoked' })
  } catch (error: any) {
    console.error('Error revoking token:', error)
    return res.status(500).json({ error: 'Failed to revoke token' })
  }
})

// ---------------------------------------------------------------------------
// Org-tokens sub-router (mounted at /api/organizations in index.ts)
// GET /api/organizations/:orgId/tokens
// ---------------------------------------------------------------------------

export const orgTokensRouter = express.Router()

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
orgTokensRouter.get('/:orgId/tokens', authenticateFlexible, async (req: any, res: Response) => {
  try {
    const { orgId } = req.params
    const isAdmin = await isOrgAdminOrOwner(req.user.id, orgId)
    if (!isAdmin) {
      return res.status(403).json({ error: 'Insufficient permissions: must be org owner or admin' })
    }
    const tokens = await listTokensForOwner('org', orgId)
    const safe = tokens.map(({ ...t }: any) => {
      delete t.token
      delete t.token_hash
      return t
    })
    return res.json({ tokens: safe })
  } catch (error: any) {
    console.error('Error listing org tokens:', error)
    return res.status(500).json({ error: 'Failed to list org tokens' })
  }
})

export default router
