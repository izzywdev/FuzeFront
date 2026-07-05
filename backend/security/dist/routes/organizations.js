"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const uuid_1 = require("uuid");
const crypto_1 = __importDefault(require("crypto"));
const auth_1 = require("../middleware/auth");
const permissions_1 = require("../middleware/permissions");
const database_1 = require("../config/database");
const organizationProvisioning_1 = require("../services/organizationProvisioning");
const eventPublisher_1 = require("../services/eventPublisher");
const role_assignment_1 = require("../utils/permit/role-assignment");
const schema_1 = require("../permit/schema");
const router = express_1.default.Router();
// `settings`/`metadata`/`permissions` are JSONB columns. The `pg` driver already
// parses JSONB into JS objects on read, so calling JSON.parse on them again throws
// "Unexpected token o in JSON" (it stringifies the object to "[object Object]"
// first). This tolerates both shapes — a string (parse it) or an already-parsed
// object/null (pass through) — so reads never 500 regardless of driver behavior.
function parseJsonb(value) {
    if (value === null || value === undefined)
        return {};
    if (typeof value === 'string')
        return JSON.parse(value || '{}');
    return value;
}
// Input validation helpers
function validateOrganizationInput(data) {
    const errors = [];
    if (!data.name ||
        typeof data.name !== 'string' ||
        data.name.trim().length === 0) {
        errors.push('Name is required and must be a non-empty string');
    }
    if (data.name && data.name.length > 255) {
        errors.push('Name must be 255 characters or less');
    }
    if (!data.slug ||
        typeof data.slug !== 'string' ||
        data.slug.trim().length === 0) {
        errors.push('Slug is required and must be a non-empty string');
    }
    if (data.slug && data.slug.length > 100) {
        errors.push('Slug must be 100 characters or less');
    }
    // Validate slug format (alphanumeric, hyphens, underscores only)
    if (data.slug && !/^[a-zA-Z0-9_-]+$/.test(data.slug)) {
        errors.push('Slug can only contain letters, numbers, hyphens, and underscores');
    }
    if (data.type &&
        !['platform', 'organization', 'personal'].includes(data.type)) {
        errors.push('Type must be one of "platform", "organization", "personal"');
    }
    return errors;
}
function sanitizeInput(data) {
    return {
        name: data.name?.trim(),
        slug: data.slug?.trim().toLowerCase(),
        type: data.type || 'organization',
        parent_id: data.parent_id?.trim() || null,
        settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
        metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
    };
}
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
// Helper: check if the requesting user is owner or admin of an org
async function requireOrgAdminOrOwner(userId, orgId) {
    const membership = await (0, database_1.db)('organization_memberships')
        .where('user_id', userId)
        .where('organization_id', orgId)
        .where('status', 'active')
        .whereIn('role', ['owner', 'admin'])
        .first();
    return !!membership;
}
// POST /api/organizations - Create a new organization
router.post('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const input = sanitizeInput(req.body);
        const validationErrors = validateOrganizationInput(input);
        if (validationErrors.length > 0) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validationErrors,
            });
        }
        // Check if slug already exists
        const existingOrg = await (0, database_1.db)('organizations')
            .where('slug', input.slug)
            .first();
        if (existingOrg) {
            return res.status(409).json({
                error: 'An organization with this slug already exists',
            });
        }
        // Validate parent organization if specified
        if (input.parent_id) {
            const parentOrg = await (0, database_1.db)('organizations')
                .where('id', input.parent_id)
                .where('is_active', true)
                .first();
            if (!parentOrg) {
                return res.status(400).json({
                    error: 'Parent organization not found or inactive',
                });
            }
            // Check if user has permission to create sub-organizations
            const membership = await (0, database_1.db)('organization_memberships')
                .where('user_id', req.user.id)
                .where('organization_id', input.parent_id)
                .where('status', 'active')
                .whereIn('role', ['owner', 'admin'])
                .first();
            if (!membership) {
                return res.status(403).json({
                    error: 'Insufficient permissions to create sub-organization in parent organization',
                });
            }
        }
        const organizationId = (0, uuid_1.v4)();
        // Create organization in transaction
        await database_1.db.transaction(async (trx) => {
            // Insert organization
            await trx('organizations').insert({
                id: organizationId,
                name: input.name,
                slug: input.slug,
                parent_id: input.parent_id,
                owner_id: req.user.id,
                type: input.type,
                settings: JSON.stringify(input.settings),
                metadata: JSON.stringify(input.metadata),
                is_active: true,
            });
            // Create owner membership
            await trx('organization_memberships').insert({
                id: (0, uuid_1.v4)(),
                user_id: req.user.id,
                organization_id: organizationId,
                role: 'owner',
                status: 'active',
                joined_at: new Date(),
                permissions: JSON.stringify({}),
                metadata: JSON.stringify({}),
            });
        });
        // Fetch the created organization
        const newOrganization = await (0, database_1.db)('organizations')
            .where('id', organizationId)
            .first();
        const organization = {
            id: newOrganization.id,
            name: newOrganization.name,
            slug: newOrganization.slug,
            parent_id: newOrganization.parent_id,
            owner_id: newOrganization.owner_id,
            type: newOrganization.type,
            settings: parseJsonb(newOrganization.settings),
            metadata: parseJsonb(newOrganization.metadata),
            is_active: newOrganization.is_active,
            created_at: newOrganization.created_at,
            updated_at: newOrganization.updated_at,
        };
        // Provision Permit wiring via the idempotent, resumable reconciler instead
        // of a fire-and-forget Promise.all. We await it so the per-step state is
        // recorded, but a Permit outage must not 500 the create — the org is created
        // in `pending` and will self-heal on the user's next login (or via the
        // internal provision endpoint), so we swallow reconciler errors here.
        try {
            await (0, organizationProvisioning_1.reconcileOrganizationProvisioning)(organizationId);
        }
        catch (error) {
            console.error(`Provisioning reconcile failed for org ${organizationId} (will self-heal):`, error);
        }
        res.status(201).json(organization);
    }
    catch (error) {
        console.error('Error creating organization:', error);
        // Check for unique constraint violations
        if (error.code === '23505' || error.message?.includes('duplicate key')) {
            return res.status(409).json({
                error: 'An organization with this slug already exists',
            });
        }
        res.status(500).json({ error: 'Failed to create organization' });
    }
});
// GET /api/organizations - List organizations with filtering and pagination
router.get('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 25, type, parent_id, is_active = true, search, sort = 'name', order = 'asc', } = req.query;
        // Validate pagination parameters
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;
        // Validate sort parameters
        const validSortFields = ['name', 'slug', 'type', 'created_at', 'updated_at'];
        const sortField = validSortFields.includes(sort) ? sort : 'name';
        const sortOrder = ['asc', 'desc'].includes(order) ? order : 'asc';
        // Build query
        let query = (0, database_1.db)('organizations')
            .select('organizations.*')
            .leftJoin('organization_memberships', function () {
            this.on('organizations.id', '=', 'organization_memberships.organization_id')
                .andOn('organization_memberships.user_id', '=', database_1.db.raw('?', [req.user.id]))
                .andOn('organization_memberships.status', '=', database_1.db.raw('?', ['active']));
        })
            .where(function () {
            // User can see organizations they are members of, or public organizations
            this.whereNotNull('organization_memberships.id').orWhere('organizations.type', 'platform');
        });
        // Apply filters
        if (type) {
            query = query.where('organizations.type', type);
        }
        if (parent_id !== undefined) {
            if (parent_id === '') {
                query = query.whereNull('organizations.parent_id');
            }
            else {
                query = query.where('organizations.parent_id', parent_id);
            }
        }
        if (is_active !== undefined) {
            // is_active arrives EITHER as the boolean default (true, when the client
            // omits it) OR as a query-string ('true'/'false'). The old `=== 'true'`
            // test made the boolean default `true` compare false → the query filtered
            // for is_active=FALSE and hid every active org, so GET returned an empty
            // list and the WorkspaceProvisioningGate spun forever. Coerce both shapes.
            const activeBool = is_active === true || is_active === 'true' || is_active === '1';
            query = query.where('organizations.is_active', activeBool);
        }
        if (search) {
            query = query.where(function () {
                this.whereILike('organizations.name', `%${search}%`).orWhereILike('organizations.slug', `%${search}%`);
            });
        }
        // Get total count. clearSelect() drops the `organizations.*` projection so the
        // count query is a plain count(*) (otherwise Postgres requires a GROUP BY).
        const countQuery = query.clone().clearSelect().count('* as total').first();
        const totalResult = await countQuery;
        const total = parseInt(totalResult?.total || '0');
        // Apply sorting and pagination
        const organizations = await query
            .orderBy(`organizations.${sortField}`, sortOrder)
            .limit(limitNum)
            .offset(offset);
        // Transform results
        const transformedOrganizations = organizations.map(org => ({
            id: org.id,
            name: org.name,
            slug: org.slug,
            parent_id: org.parent_id,
            owner_id: org.owner_id,
            type: org.type,
            settings: parseJsonb(org.settings),
            metadata: parseJsonb(org.metadata),
            is_active: org.is_active,
            created_at: org.created_at,
            updated_at: org.updated_at,
        }));
        res.json({
            organizations: transformedOrganizations,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
                hasNext: pageNum * limitNum < total,
                hasPrev: pageNum > 1,
            },
        });
    }
    catch (error) {
        console.error('Error fetching organizations:', error);
        res.status(500).json({ error: 'Failed to fetch organizations' });
    }
});
// GET /api/organizations/:id - Get organization by ID
router.get('/:id', auth_1.authenticateToken, permissions_1.PermissionMiddleware.canReadOrganization, async (req, res) => {
    try {
        const { id } = req.params;
        // Check if user has access to this organization
        const organization = await (0, database_1.db)('organizations')
            .select('organizations.*')
            .leftJoin('organization_memberships', function () {
            this.on('organizations.id', '=', 'organization_memberships.organization_id')
                .andOn('organization_memberships.user_id', '=', database_1.db.raw('?', [req.user.id]))
                .andOn('organization_memberships.status', '=', database_1.db.raw('?', ['active']));
        })
            .where('organizations.id', id)
            .where(function () {
            // User can see organizations they are members of, or public organizations
            this.whereNotNull('organization_memberships.id').orWhere('organizations.type', 'platform');
        })
            .first();
        if (!organization) {
            return res
                .status(404)
                .json({ error: 'Organization not found or access denied' });
        }
        const result = {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            parent_id: organization.parent_id,
            owner_id: organization.owner_id,
            type: organization.type,
            settings: parseJsonb(organization.settings),
            metadata: parseJsonb(organization.metadata),
            is_active: organization.is_active,
            created_at: organization.created_at,
            updated_at: organization.updated_at,
        };
        res.json(result);
    }
    catch (error) {
        console.error('Error fetching organization:', error);
        res.status(500).json({ error: 'Failed to fetch organization' });
    }
});
// PUT /api/organizations/:id - Update organization
router.put('/:id', auth_1.authenticateToken, permissions_1.PermissionMiddleware.canUpdateOrganization, async (req, res) => {
    try {
        const { id } = req.params;
        const input = sanitizeInput(req.body);
        // Check if user has permission to update this organization
        const membership = await (0, database_1.db)('organization_memberships')
            .where('user_id', req.user.id)
            .where('organization_id', id)
            .where('status', 'active')
            .whereIn('role', ['owner', 'admin'])
            .first();
        if (!membership) {
            return res.status(403).json({
                error: 'Insufficient permissions to update this organization',
            });
        }
        // Validate input
        const validationErrors = validateOrganizationInput(input);
        if (validationErrors.length > 0) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validationErrors,
            });
        }
        // Check if slug conflicts with another organization
        if (input.slug) {
            const existingOrg = await (0, database_1.db)('organizations')
                .where('slug', input.slug)
                .where('id', '!=', id)
                .first();
            if (existingOrg) {
                return res.status(409).json({
                    error: 'An organization with this slug already exists',
                });
            }
        }
        // Update organization
        await (0, database_1.db)('organizations')
            .where('id', id)
            .update({
            name: input.name,
            slug: input.slug,
            settings: JSON.stringify(input.settings),
            metadata: JSON.stringify(input.metadata),
            updated_at: new Date(),
        });
        // Fetch updated organization
        const updatedOrganization = await (0, database_1.db)('organizations')
            .where('id', id)
            .first();
        const result = {
            id: updatedOrganization.id,
            name: updatedOrganization.name,
            slug: updatedOrganization.slug,
            parent_id: updatedOrganization.parent_id,
            owner_id: updatedOrganization.owner_id,
            type: updatedOrganization.type,
            settings: parseJsonb(updatedOrganization.settings),
            metadata: parseJsonb(updatedOrganization.metadata),
            is_active: updatedOrganization.is_active,
            created_at: updatedOrganization.created_at,
            updated_at: updatedOrganization.updated_at,
        };
        res.json(result);
    }
    catch (error) {
        console.error('Error updating organization:', error);
        if (error.code === '23505' || error.message?.includes('duplicate key')) {
            return res.status(409).json({
                error: 'An organization with this slug already exists',
            });
        }
        res.status(500).json({ error: 'Failed to update organization' });
    }
});
// DELETE /api/organizations/:id - Deactivate organization
router.delete('/:id', auth_1.authenticateToken, permissions_1.PermissionMiddleware.canDeleteOrganization, async (req, res) => {
    try {
        const { id } = req.params;
        // Check if user is owner of this organization
        const membership = await (0, database_1.db)('organization_memberships')
            .where('user_id', req.user.id)
            .where('organization_id', id)
            .where('status', 'active')
            .where('role', 'owner')
            .first();
        if (!membership) {
            return res.status(403).json({
                error: 'Only organization owners can deactivate organizations',
            });
        }
        // Check for child organizations
        const childOrganizations = await (0, database_1.db)('organizations')
            .where('parent_id', id)
            .where('is_active', true)
            .count('* as count')
            .first();
        if (parseInt(childOrganizations?.count || '0') > 0) {
            return res.status(400).json({
                error: 'Cannot deactivate organization with active child organizations',
            });
        }
        // Deactivate organization (soft delete)
        await (0, database_1.db)('organizations').where('id', id).update({
            is_active: false,
            updated_at: new Date(),
        });
        res.json({ message: 'Organization deactivated successfully' });
    }
    catch (error) {
        console.error('Error deactivating organization:', error);
        res.status(500).json({ error: 'Failed to deactivate organization' });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// Invitation sub-routes: /api/organizations/:id/invitations
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/organizations/:id/invitations — list pending invitations
router.get('/:id/invitations', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const isAdmin = await requireOrgAdminOrOwner(req.user.id, id);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        const invitations = await (0, database_1.db)('organization_invitations')
            .where('organization_id', id)
            .whereIn('status', ['pending'])
            .orderBy('created_at', 'desc');
        res.json({ invitations });
    }
    catch (error) {
        console.error('Error listing invitations:', error);
        res.status(500).json({ error: 'Failed to list invitations' });
    }
});
// POST /api/organizations/:id/invitations — create invitation
router.post('/:id/invitations', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { email, role = 'member' } = req.body;
        // Validate email
        if (!email || typeof email !== 'string' || !isValidEmail(email.trim())) {
            return res.status(400).json({ error: 'A valid email address is required' });
        }
        // Validate role — owner cannot be invited; only admin/member/viewer are allowed
        const ALLOWED_INVITE_ROLES = ['admin', 'member', 'viewer'];
        if (!ALLOWED_INVITE_ROLES.includes(role)) {
            return res.status(400).json({ error: `Invalid role. Allowed values: ${ALLOWED_INVITE_ROLES.join(', ')}` });
        }
        const normalizedEmail = email.toLowerCase().trim();
        // Permission check
        const isAdmin = await requireOrgAdminOrOwner(req.user.id, id);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        // Check for existing pending invitation
        const existing = await (0, database_1.db)('organization_invitations')
            .where('organization_id', id)
            .where('email', normalizedEmail)
            .where('status', 'pending')
            .first();
        if (existing) {
            return res.status(409).json({ error: 'A pending invitation already exists for this email' });
        }
        const token = crypto_1.default.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const invitationId = (0, uuid_1.v4)();
        const correlationId = (0, uuid_1.v4)();
        await (0, database_1.db)('organization_invitations').insert({
            id: invitationId,
            organization_id: id,
            email: normalizedEmail,
            role,
            token,
            expires_at: expiresAt,
            status: 'pending',
            invited_by: req.user.id,
        });
        // Fire email event (non-blocking — swallow errors so invite still succeeds)
        try {
            const org = await (0, database_1.db)('organizations').where('id', id).first();
            const inviter = await (0, database_1.db)('users').where('id', req.user.id).first();
            const inviterName = inviter
                ? (`${inviter.first_name || ''} ${inviter.last_name || ''}`.trim() || inviter.email)
                : req.user.email;
            const acceptUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/invitations/${token}`;
            await eventPublisher_1.defaultEventPublisher.publishNotifyEmailRequested({
                to: normalizedEmail,
                template: 'org-invite',
                vars: { orgName: org?.name ?? '', inviterName, role, acceptUrl },
                orgId: id,
                correlationId,
            }, correlationId);
        }
        catch (emailErr) {
            console.error('Failed to publish invite email event (non-fatal):', emailErr);
        }
        res.status(201).json({
            invitation: {
                id: invitationId,
                organizationId: id,
                email: normalizedEmail,
                role,
                expiresAt,
                status: 'pending',
            },
        });
    }
    catch (error) {
        console.error('Error creating invitation:', error);
        res.status(500).json({ error: 'Failed to create invitation' });
    }
});
// POST /api/organizations/:id/invitations/bulk — bulk create (max 50 emails)
// NOTE: must be registered BEFORE /:id/invitations/:invitationId routes to avoid
// "bulk" being treated as an invitationId.
router.post('/:id/invitations/bulk', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { emails, role = 'member' } = req.body;
        if (!Array.isArray(emails)) {
            return res.status(400).json({ error: 'emails must be an array' });
        }
        if (emails.length > 50) {
            return res.status(400).json({ error: 'Cannot exceed 50 emails in a single bulk invite' });
        }
        // Validate role — owner cannot be invited; only admin/member/viewer are allowed
        const ALLOWED_INVITE_ROLES = ['admin', 'member', 'viewer'];
        if (!ALLOWED_INVITE_ROLES.includes(role)) {
            return res.status(400).json({ error: `Invalid role. Allowed values: ${ALLOWED_INVITE_ROLES.join(', ')}` });
        }
        const isAdmin = await requireOrgAdminOrOwner(req.user.id, id);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        const org = await (0, database_1.db)('organizations').where('id', id).first();
        const inviter = await (0, database_1.db)('users').where('id', req.user.id).first();
        const inviterName = inviter
            ? (`${inviter.first_name || ''} ${inviter.last_name || ''}`.trim() || inviter.email)
            : req.user.email;
        const results = [];
        for (const rawEmail of emails) {
            if (typeof rawEmail !== 'string' || !isValidEmail(rawEmail.trim())) {
                results.push({ email: rawEmail, status: 'skipped', error: 'Invalid email format' });
                continue;
            }
            const normalizedEmail = rawEmail.toLowerCase().trim();
            try {
                const existing = await (0, database_1.db)('organization_invitations')
                    .where('organization_id', id)
                    .where('email', normalizedEmail)
                    .where('status', 'pending')
                    .first();
                if (existing) {
                    results.push({ email: normalizedEmail, status: 'skipped', error: 'Pending invitation already exists' });
                    continue;
                }
                const token = crypto_1.default.randomBytes(32).toString('hex');
                const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                const invitationId = (0, uuid_1.v4)();
                const correlationId = (0, uuid_1.v4)();
                await (0, database_1.db)('organization_invitations').insert({
                    id: invitationId,
                    organization_id: id,
                    email: normalizedEmail,
                    role,
                    token,
                    expires_at: expiresAt,
                    status: 'pending',
                    invited_by: req.user.id,
                });
                const acceptUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/invitations/${token}`;
                await eventPublisher_1.defaultEventPublisher.publishNotifyEmailRequested({
                    to: normalizedEmail,
                    template: 'org-invite',
                    vars: { orgName: org?.name ?? '', inviterName, role, acceptUrl },
                    orgId: id,
                    correlationId,
                }, correlationId).catch(err => console.error('Email event failed (non-fatal):', err));
                results.push({ email: normalizedEmail, status: 'invited' });
            }
            catch (err) {
                results.push({ email: normalizedEmail, status: 'error', error: 'Internal error' });
            }
        }
        res.status(201).json({ results });
    }
    catch (error) {
        console.error('Error bulk inviting:', error);
        res.status(500).json({ error: 'Failed to process bulk invitations' });
    }
});
// POST /api/organizations/:id/invitations/:invitationId/resend — resend email
router.post('/:id/invitations/:invitationId/resend', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id, invitationId } = req.params;
        const isAdmin = await requireOrgAdminOrOwner(req.user.id, id);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        const invitation = await (0, database_1.db)('organization_invitations')
            .where('id', invitationId)
            .where('organization_id', id)
            .first();
        if (!invitation) {
            return res.status(404).json({ error: 'Invitation not found' });
        }
        if (invitation.status !== 'pending') {
            return res.status(409).json({ error: `Cannot resend a ${invitation.status} invitation` });
        }
        // Extend expiry
        const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await (0, database_1.db)('organization_invitations')
            .where('id', invitationId)
            .update({ expires_at: newExpiresAt });
        try {
            const org = await (0, database_1.db)('organizations').where('id', id).first();
            const inviter = await (0, database_1.db)('users').where('id', req.user.id).first();
            const inviterName = inviter
                ? (`${inviter.first_name || ''} ${inviter.last_name || ''}`.trim() || inviter.email)
                : req.user.email;
            const acceptUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/invitations/${invitation.token}`;
            const correlationId = (0, uuid_1.v4)();
            await eventPublisher_1.defaultEventPublisher.publishNotifyEmailRequested({
                to: invitation.email,
                template: 'org-invite',
                vars: { orgName: org?.name ?? '', inviterName, role: invitation.role, acceptUrl },
                orgId: id,
                correlationId,
            }, correlationId);
        }
        catch (emailErr) {
            console.error('Failed to publish resend email event (non-fatal):', emailErr);
        }
        res.json({ message: 'Invitation resent successfully' });
    }
    catch (error) {
        console.error('Error resending invitation:', error);
        res.status(500).json({ error: 'Failed to resend invitation' });
    }
});
// DELETE /api/organizations/:id/invitations/:invitationId — revoke
router.delete('/:id/invitations/:invitationId', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id, invitationId } = req.params;
        const isAdmin = await requireOrgAdminOrOwner(req.user.id, id);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        const invitation = await (0, database_1.db)('organization_invitations')
            .where('id', invitationId)
            .where('organization_id', id)
            .first();
        if (!invitation) {
            return res.status(404).json({ error: 'Invitation not found' });
        }
        await (0, database_1.db)('organization_invitations')
            .where('id', invitationId)
            .update({ status: 'revoked' });
        res.json({ message: 'Invitation revoked successfully' });
    }
    catch (error) {
        console.error('Error revoking invitation:', error);
        res.status(500).json({ error: 'Failed to revoke invitation' });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// Roles catalog: /api/organizations/:id/roles
// ─────────────────────────────────────────────────────────────────────────────
// Org-role → permit-role mapping (see src/permit/schema.ts header). Used to
// derive each org role's effective permission set from the permit schema.
const ORG_ROLE_TO_PERMIT_ROLE = {
    owner: 'admin',
    admin: 'admin',
    member: 'editor',
    viewer: 'viewer',
};
// Display names + ordering for the org-facing role catalog. `owner` is never
// assignable (matches the invite/role-change rule that owner cannot be granted).
const ORG_ROLE_CATALOG = [
    { key: 'owner', name: 'Owner', assignable: false },
    { key: 'admin', name: 'Admin', assignable: true },
    { key: 'member', name: 'Member', assignable: true },
    { key: 'viewer', name: 'Viewer', assignable: true },
];
/**
 * @swagger
 * /api/organizations/{id}/roles:
 *   get:
 *     summary: Get the organization role + permission catalog
 *     description: >-
 *       Returns the read-only catalog of assignable organization roles (with
 *       their effective permissions) and the resource/action catalog they map
 *       to. Any active member of the organization may view it.
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Role + resource catalog
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 roles:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key: { type: string }
 *                       name: { type: string }
 *                       assignable: { type: boolean }
 *                       permissions:
 *                         type: array
 *                         items: { type: string }
 *                 resources:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key: { type: string }
 *                       name: { type: string }
 *                       actions:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             key: { type: string }
 *                             name: { type: string }
 *       403:
 *         description: Caller is not an active member of the organization
 */
// GET /api/organizations/:id/roles — read-only role/permission catalog
router.get('/:id/roles', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        // Any active member (any role) may view the catalog
        const callerMembership = await (0, database_1.db)('organization_memberships')
            .where('user_id', req.user.id)
            .where('organization_id', id)
            .where('status', 'active')
            .first();
        if (!callerMembership) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        const permitRolePermissions = new Map(schema_1.permitSchema.roles.map((r) => [r.key, r.permissions]));
        const roles = ORG_ROLE_CATALOG.map((role) => ({
            key: role.key,
            name: role.name,
            assignable: role.assignable,
            permissions: permitRolePermissions.get(ORG_ROLE_TO_PERMIT_ROLE[role.key]) ?? [],
        }));
        const resources = schema_1.permitSchema.resources.map((resource) => ({
            key: resource.key,
            name: resource.name,
            actions: Object.entries(resource.actions).map(([key, def]) => ({
                key,
                name: def.name,
            })),
        }));
        res.json({ roles, resources });
    }
    catch (error) {
        console.error('Error listing organization roles:', error);
        res.status(500).json({ error: 'Failed to list organization roles' });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// Members sub-routes: /api/organizations/:id/members
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/organizations/{id}/members:
 *   get:
 *     summary: List organization members (paginated)
 *     description: >-
 *       Returns a paginated list of active members of the organization. Any
 *       active member of the organization (any role) may view the list.
 *       Supports a case-insensitive `search` over email / first name / last name.
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Case-insensitive match against email, first name, or last name.
 *     responses:
 *       200:
 *         description: Paginated members envelope
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 members:
 *                   type: array
 *                   items: { type: object }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     pageSize: { type: integer }
 *                     total: { type: integer }
 *       403:
 *         description: Caller is not an active member of the organization
 */
// GET /api/organizations/:id/members — list members (any active member may view)
router.get('/:id/members', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        // Any active member (any role) may list members
        const callerMembership = await (0, database_1.db)('organization_memberships')
            .where('user_id', req.user.id)
            .where('organization_id', id)
            .where('status', 'active')
            .first();
        if (!callerMembership) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        // Validate/clamp pagination params (clamp rather than reject; junk → defaults)
        const parsePositiveInt = (raw, fallback) => {
            const n = parseInt(String(raw), 10);
            return Number.isFinite(n) && n >= 1 ? n : fallback;
        };
        const page = parsePositiveInt(req.query.page, 1);
        const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 20), 100);
        const offset = (page - 1) * pageSize;
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
        // Shared filter builder — applied to both the count and the page query so
        // `total` reflects the same search predicate as the returned rows.
        const applyFilters = (q) => {
            q.where('organization_memberships.organization_id', id).where('organization_memberships.status', 'active');
            if (search) {
                const like = `%${search.toLowerCase()}%`;
                q.whereRaw('(LOWER(users.email) LIKE ? OR LOWER(users.first_name) LIKE ? OR LOWER(users.last_name) LIKE ?)', [like, like, like]);
            }
            return q;
        };
        const countQuery = applyFilters((0, database_1.db)('organization_memberships').join('users', 'users.id', 'organization_memberships.user_id'));
        const countRow = await countQuery
            .count('organization_memberships.id as count')
            .first();
        const total = parseInt(countRow?.count || '0', 10) || 0;
        const rows = await applyFilters((0, database_1.db)('organization_memberships')
            .select('organization_memberships.id', 'organization_memberships.role', 'organization_memberships.status', 'organization_memberships.joined_at', 'users.id as user_id', 'users.email as user_email', 'users.first_name', 'users.last_name')
            .join('users', 'users.id', 'organization_memberships.user_id'))
            .orderBy('organization_memberships.joined_at', 'asc')
            .limit(pageSize)
            .offset(offset);
        const members = rows.map((row) => ({
            id: row.id,
            role: row.role,
            status: row.status,
            user: {
                id: row.user_id,
                email: row.user_email,
                firstName: row.first_name,
                lastName: row.last_name,
            },
            joined_at: row.joined_at,
            invited_at: null,
        }));
        res.json({ members, pagination: { page, pageSize, total } });
    }
    catch (error) {
        console.error('Error listing members:', error);
        res.status(500).json({ error: 'Failed to list members' });
    }
});
// POST /api/organizations/:id/members — invite a single member (legacy path)
// Creates a pending invitation row, identical to POST /:id/invitations.
router.post('/:id/members', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { email, role = 'member' } = req.body;
        // Validate email
        if (!email || typeof email !== 'string' || !isValidEmail(email.trim())) {
            return res.status(400).json({ error: 'A valid email address is required' });
        }
        // Validate role — owner cannot be invited
        const ALLOWED_INVITE_ROLES = ['admin', 'member', 'viewer'];
        if (!ALLOWED_INVITE_ROLES.includes(role)) {
            return res.status(400).json({ error: `Invalid role. Allowed values: ${ALLOWED_INVITE_ROLES.join(', ')}` });
        }
        const normalizedEmail = email.toLowerCase().trim();
        // Permission check — admin or owner only
        const isAdmin = await requireOrgAdminOrOwner(req.user.id, id);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        // Dedupe check
        const existing = await (0, database_1.db)('organization_invitations')
            .where('organization_id', id)
            .where('email', normalizedEmail)
            .where('status', 'pending')
            .first();
        if (existing) {
            return res.status(409).json({ error: 'A pending invitation already exists for this email' });
        }
        const token = crypto_1.default.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const invitationId = (0, uuid_1.v4)();
        const correlationId = (0, uuid_1.v4)();
        await (0, database_1.db)('organization_invitations').insert({
            id: invitationId,
            organization_id: id,
            email: normalizedEmail,
            role,
            token,
            expires_at: expiresAt,
            status: 'pending',
            invited_by: req.user.id,
        });
        // Fire email event (non-blocking)
        try {
            const org = await (0, database_1.db)('organizations').where('id', id).first();
            const inviter = await (0, database_1.db)('users').where('id', req.user.id).first();
            const inviterName = inviter
                ? (`${inviter.first_name || ''} ${inviter.last_name || ''}`.trim() || inviter.email)
                : req.user.email;
            const acceptUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/invitations/${token}`;
            await eventPublisher_1.defaultEventPublisher.publishNotifyEmailRequested({
                to: normalizedEmail,
                template: 'org-invite',
                vars: { orgName: org?.name ?? '', inviterName, role, acceptUrl },
                orgId: id,
                correlationId,
            }, correlationId);
        }
        catch (emailErr) {
            console.error('Failed to publish invite email event (non-fatal):', emailErr);
        }
        res.status(201).json({
            invitation: {
                id: invitationId,
                organizationId: id,
                email: normalizedEmail,
                role,
                expiresAt,
                status: 'pending',
            },
        });
    }
    catch (error) {
        console.error('Error creating member invitation:', error);
        res.status(500).json({ error: 'Failed to create invitation' });
    }
});
// PUT /api/organizations/:id/members/:memberId — change a member's role
router.put('/:id/members/:memberId', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id, memberId } = req.params;
        const { role } = req.body;
        // Validate role
        const ALLOWED_ROLES = ['admin', 'member', 'viewer'];
        if (!role || !ALLOWED_ROLES.includes(role)) {
            return res.status(400).json({ error: `Invalid role. Allowed values: ${ALLOWED_ROLES.join(', ')}` });
        }
        // Permission check
        const isAdmin = await requireOrgAdminOrOwner(req.user.id, id);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        // Fetch target membership
        const membership = await (0, database_1.db)('organization_memberships')
            .where('id', memberId)
            .where('organization_id', id)
            .first();
        if (!membership) {
            return res.status(404).json({ error: 'Member not found' });
        }
        // Protect owner memberships
        if (membership.role === 'owner') {
            return res.status(403).json({ error: 'Cannot change the role of an owner' });
        }
        await (0, database_1.db)('organization_memberships')
            .where('id', memberId)
            .update({ role });
        const updated = await (0, database_1.db)('organization_memberships')
            .where('id', memberId)
            .first();
        // Assign Permit role — non-blocking
        try {
            await (0, role_assignment_1.assignOrganizationRole)(membership.user_id, id, role);
        }
        catch (permitErr) {
            console.error(`Permit role update failed for membership ${memberId} (non-fatal):`, permitErr);
        }
        res.json(updated);
    }
    catch (error) {
        console.error('Error updating member role:', error);
        res.status(500).json({ error: 'Failed to update member role' });
    }
});
// DELETE /api/organizations/:id/members/:memberId — remove a member
router.delete('/:id/members/:memberId', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id, memberId } = req.params;
        // Permission check
        const isAdmin = await requireOrgAdminOrOwner(req.user.id, id);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        // Fetch target membership
        const membership = await (0, database_1.db)('organization_memberships')
            .where('id', memberId)
            .where('organization_id', id)
            .first();
        if (!membership) {
            return res.status(404).json({ error: 'Member not found' });
        }
        // Protect owner memberships
        if (membership.role === 'owner') {
            return res.status(403).json({ error: 'Cannot remove the organization owner' });
        }
        await (0, database_1.db)('organization_memberships')
            .where('id', memberId)
            .delete();
        res.json({ message: 'Member removed' });
    }
    catch (error) {
        console.error('Error removing member:', error);
        res.status(500).json({ error: 'Failed to remove member' });
    }
});
exports.default = router;
//# sourceMappingURL=organizations.js.map