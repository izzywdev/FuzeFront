"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskEmail = maskEmail;
/**
 * Public token-based invitation routes.
 * GET  /api/invitations/:token         — resolve (no auth required)
 * POST /api/invitations/:token/accept  — accept (auth optional)
 */
const express_1 = __importDefault(require("express"));
const uuid_1 = require("uuid");
const database_1 = require("../config/database");
const role_assignment_1 = require("../utils/permit/role-assignment");
const router = express_1.default.Router();
/**
 * Mask an email address for safe public exposure.
 * Only the first character before '@' is preserved; the rest is replaced with '***'.
 * Example: 'user@example.com' → 'u***@example.com'
 */
function maskEmail(email) {
    const atIndex = email.indexOf('@');
    if (atIndex <= 0)
        return '***';
    return email[0] + '***' + email.slice(atIndex);
}
// GET /api/invitations/:token — public, no auth
router.get('/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const invitation = await (0, database_1.db)('organization_invitations')
            .where('token', token)
            .first();
        if (!invitation) {
            return res.status(404).json({ error: 'Invitation not found' });
        }
        // Expired by status or by time
        if (invitation.status !== 'pending' || new Date(invitation.expires_at) < new Date()) {
            return res.status(410).json({ error: 'This invitation has expired or been revoked' });
        }
        const organization = await (0, database_1.db)('organizations')
            .where('id', invitation.organization_id)
            .first();
        res.json({
            invitation: {
                id: invitation.id,
                email: maskEmail(invitation.email),
                role: invitation.role,
                expires_at: invitation.expires_at,
                status: invitation.status,
            },
            organization: {
                id: organization?.id,
                name: organization?.name,
                slug: organization?.slug,
            },
        });
    }
    catch (error) {
        console.error('Error resolving invitation:', error);
        res.status(500).json({ error: 'Failed to resolve invitation' });
    }
});
// POST /api/invitations/:token/accept — accept (auth optional via req.user)
router.post('/:token/accept', async (req, res) => {
    try {
        const { token } = req.params;
        const invitation = await (0, database_1.db)('organization_invitations')
            .where('token', token)
            .first();
        if (!invitation) {
            return res.status(404).json({ error: 'Invitation not found' });
        }
        // Not authenticated: direct to enroll
        if (!req.user) {
            const enrollUrl = `${process.env.AUTHENTIK_ISSUER_URL || ''}/if/flow/enrollment/`;
            return res.status(202).json({
                action: 'enroll',
                enrollUrl,
                message: 'Please create an account or sign in to accept this invitation',
            });
        }
        // Email mismatch
        if (req.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
            return res.status(403).json({
                error: 'This invitation was sent to a different email address',
            });
        }
        // Revoked or expired (check before CAS so we give an informative 410, not a 409)
        if (invitation.status === 'revoked' || new Date(invitation.expires_at) < new Date()) {
            return res.status(410).json({ error: 'This invitation has expired or been revoked' });
        }
        // Atomic compare-and-swap accept: transition status pending→accepted inside
        // the transaction. If another request raced us, rowCount will be 0 → 409.
        let casSucceeded = false;
        await database_1.db.transaction(async (trx) => {
            const result = await trx.raw(`UPDATE organization_invitations SET status='accepted' WHERE id=? AND status='pending' RETURNING *`, [invitation.id]);
            const rowCount = result.rowCount ?? (result.rows ? result.rows.length : 0);
            if (rowCount === 0) {
                // Another request already accepted this invitation (race condition).
                return;
            }
            casSucceeded = true;
            // Upsert membership (user may already be a member)
            const existingMembership = await trx('organization_memberships')
                .where('user_id', req.user.id)
                .where('organization_id', invitation.organization_id)
                .first();
            if (!existingMembership) {
                await trx('organization_memberships').insert({
                    id: (0, uuid_1.v4)(),
                    user_id: req.user.id,
                    organization_id: invitation.organization_id,
                    role: invitation.role,
                    status: 'active',
                    joined_at: new Date(),
                    permissions: JSON.stringify({}),
                    metadata: JSON.stringify({}),
                });
            }
        });
        if (!casSucceeded) {
            return res.status(409).json({ error: 'Invitation has already been accepted' });
        }
        // Assign Permit role for the accepted member — non-blocking: a Permit outage
        // must not undo an accepted invitation. The role can be reconciled later.
        try {
            await (0, role_assignment_1.assignOrganizationRole)(req.user.id, invitation.organization_id, invitation.role);
        }
        catch (permitErr) {
            console.error(`Permit role assignment failed for user ${req.user.id} in org ${invitation.organization_id} (non-fatal):`, permitErr);
        }
        res.json({
            message: 'Invitation accepted successfully',
            organizationId: invitation.organization_id,
            role: invitation.role,
        });
    }
    catch (error) {
        console.error('Error accepting invitation:', error);
        res.status(500).json({ error: 'Failed to accept invitation' });
    }
});
exports.default = router;
//# sourceMappingURL=invitations.js.map