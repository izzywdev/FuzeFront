"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const uuid_1 = require("uuid");
const auth_1 = require("../middleware/auth");
const permissions_1 = require("../middleware/permissions");
const database_1 = require("../config/database");
const permit_1 = require("../utils/permit");
const router = express_1.default.Router();
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
    if (data.type && !['platform', 'organization'].includes(data.type)) {
        errors.push('Type must be either "platform" or "organization"');
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
            settings: JSON.parse(newOrganization.settings || '{}'),
            metadata: JSON.parse(newOrganization.metadata || '{}'),
            is_active: newOrganization.is_active,
            created_at: newOrganization.created_at,
            updated_at: newOrganization.updated_at,
        };
        // Integrate with Permit.io asynchronously (don't block response)
        Promise.all([
            // 1. Ensure user is synced to Permit.io
            (0, permit_1.syncUserToPermit)({
                id: req.user.id,
                email: req.user.email,
                firstName: req.user.firstName,
                lastName: req.user.lastName,
                roles: req.user.roles || [],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }),
            // 2. Create tenant for the organization
            (0, permit_1.createTenantInPermit)(organization),
            // 3. Assign owner role to the creator
            (0, permit_1.assignOrganizationRole)(req.user.id, organizationId, 'owner'),
        ]).catch(error => {
            console.error('Error syncing organization to Permit.io:', error);
            // Don't fail the API response, but log for monitoring
        });
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
            query = query.where('organizations.is_active', is_active === 'true');
        }
        if (search) {
            query = query.where(function () {
                this.whereILike('organizations.name', `%${search}%`).orWhereILike('organizations.slug', `%${search}%`);
            });
        }
        // Get total count
        const countQuery = query.clone().count('* as total').first();
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
            settings: JSON.parse(org.settings || '{}'),
            metadata: JSON.parse(org.metadata || '{}'),
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
            settings: JSON.parse(organization.settings || '{}'),
            metadata: JSON.parse(organization.metadata || '{}'),
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
            settings: JSON.parse(updatedOrganization.settings || '{}'),
            metadata: JSON.parse(updatedOrganization.metadata || '{}'),
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
exports.default = router;
//# sourceMappingURL=organizations.js.map