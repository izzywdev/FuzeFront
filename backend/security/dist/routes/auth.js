"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const database_1 = require("../config/database");
const auth_1 = require("../middleware/auth");
const oidc_1 = require("../services/oidc");
const organizationProvisioning_1 = require("../services/organizationProvisioning");
const router = express_1.default.Router();
/**
 * Self-heal provisioning on login: ensure the user has a personal org and that
 * every org they own which isn't `active` gets reconciled. Fire-and-forget —
 * this must never block or fail the login response. Acts as the safety net when
 * the identity.user.created Kafka event was lost.
 */
function selfHealProvisioningOnLogin(userId) {
    (0, organizationProvisioning_1.runInternalProvision)(userId).catch(err => {
        console.error(`Login self-heal provisioning failed for ${userId}:`, err);
    });
}
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: User login
 *     description: Authenticate user with email and password, returns JWT token
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *           example:
 *             email: "admin@frontfuse.dev"
 *             password: "admin123"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/LoginResponse'
 *                 - type: object
 *                   properties:
 *                     sessionId:
 *                       type: string
 *                       format: uuid
 *                       description: Session identifier
 *             example:
 *               token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *               user:
 *                 id: "550e8400-e29b-41d4-a716-446655440000"
 *                 email: "admin@frontfuse.dev"
 *                 firstName: "Admin"
 *                 lastName: "User"
 *                 roles: ["admin", "user"]
 *               sessionId: "123e4567-e89b-12d3-a456-426614174000"
 *       400:
 *         description: Missing email or password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Email and password required"
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid credentials"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// POST /auth/login - Mock login
router.post('/login', async (req, res) => {
    const requestId = (0, uuid_1.v4)().substring(0, 8);
    const startTime = Date.now();
    console.log(`🔐 [${requestId}] Login request received:`, {
        timestamp: new Date().toISOString(),
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        origin: req.get('Origin'),
        referer: req.get('Referer'),
        contentType: req.get('Content-Type'),
        bodyKeys: Object.keys(req.body || {}),
        hasEmail: !!req.body?.email,
        hasPassword: !!req.body?.password,
        emailDomain: req.body?.email ? req.body.email.split('@')[1] : 'none',
    });
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            console.log(`❌ [${requestId}] Missing credentials:`, {
                hasEmail: !!email,
                hasPassword: !!password,
                responseTime: Date.now() - startTime,
            });
            return res.status(400).json({ error: 'Email and password required' });
        }
        console.log(`🔍 [${requestId}] Looking up user:`, {
            email,
            passwordLength: password.length,
        });
        // Find user
        const userRow = await (0, database_1.db)('users').where('email', email).first();
        if (!userRow) {
            console.log(`❌ [${requestId}] User not found:`, {
                email,
                responseTime: Date.now() - startTime,
            });
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        console.log(`👤 [${requestId}] User found:`, {
            userId: userRow.id,
            email: userRow.email,
            hasPasswordHash: !!userRow.password_hash,
            roles: userRow.roles,
        });
        // Verify password
        console.log(`🔒 [${requestId}] Verifying password...`);
        const isValidPassword = await bcryptjs_1.default.compare(password, userRow.password_hash);
        if (!isValidPassword) {
            console.log(`❌ [${requestId}] Invalid password:`, {
                email,
                responseTime: Date.now() - startTime,
            });
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        console.log(`✅ [${requestId}] Password verified, generating token...`);
        // Create the session id first so it can be embedded in the token; this lets
        // logout invalidate only THIS session rather than all of the user's sessions.
        const sessionId = (0, uuid_1.v4)();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        // Generate JWT
        const token = jsonwebtoken_1.default.sign({ userId: userRow.id, sessionId }, process.env.JWT_SECRET, { expiresIn: '24h' });
        console.log(`🎫 [${requestId}] JWT token generated:`, {
            tokenLength: token.length,
            tokenPreview: token.substring(0, 20) + '...',
        });
        console.log(`💾 [${requestId}] Creating session:`, {
            sessionId,
            expiresAt: expiresAt.toISOString(),
        });
        await (0, database_1.db)('sessions').insert({
            id: sessionId,
            user_id: userRow.id,
            expires_at: expiresAt,
        });
        // Debug logging for roles parsing
        console.log(`🔍 [${requestId}] Parsing roles:`, {
            rawRoles: userRow.roles,
            rolesType: typeof userRow.roles,
            rolesLength: userRow.roles?.length,
            firstChar: userRow.roles?.[0],
            fallback: '["user"]',
        });
        const user = {
            id: userRow.id,
            email: userRow.email,
            firstName: userRow.first_name,
            lastName: userRow.last_name,
            defaultAppId: userRow.default_app_id,
            roles: Array.isArray(userRow.roles)
                ? userRow.roles
                : JSON.parse(userRow.roles || '["user"]'),
        };
        console.log(`🎉 [${requestId}] Login successful:`, {
            userId: user.id,
            email: user.email,
            roles: user.roles,
            sessionId,
            responseTime: Date.now() - startTime,
        });
        // Self-heal provisioning in the background (does not block the response).
        selfHealProvisioningOnLogin(user.id);
        res.json({
            token,
            user,
            sessionId,
        });
    }
    catch (error) {
        console.error(`💥 [${requestId}] Login error:`, {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            responseTime: Date.now() - startTime,
        });
        res.status(500).json({ error: 'Internal server error' });
    }
});
/**
 * @swagger
 * /api/auth/user:
 *   get:
 *     summary: Get current user
 *     description: Get information about the currently authenticated user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *             example:
 *               user:
 *                 id: "550e8400-e29b-41d4-a716-446655440000"
 *                 email: "admin@frontfuse.dev"
 *                 firstName: "Admin"
 *                 lastName: "User"
 *                 roles: ["admin", "user"]
 *       401:
 *         description: Access token required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// GET /auth/user - Get current user
router.get('/user', auth_1.authenticateToken, async (req, res) => {
    res.json({ user: req.user });
});
/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: User logout
 *     description: Logout the current user and invalidate their session
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Logged out successfully"
 *       500:
 *         description: Logout failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// POST /auth/logout
router.post('/logout', auth_1.authenticateToken, async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token) {
            const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            // Invalidate only the current session, not every session the user has.
            if (decoded.sessionId) {
                await (0, database_1.db)('sessions').where('id', decoded.sessionId).del();
            }
        }
        res.json({ message: 'Logged out successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Logout failed' });
    }
});
/**
 * @swagger
 * /api/auth/oidc/login:
 *   get:
 *     summary: Initiate OIDC login
 *     description: Redirects to Authentik for OIDC authentication
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       302:
 *         description: Redirect to Authentik login page
 *       500:
 *         description: OIDC not configured or server error
 */
router.get('/oidc/login', async (req, res) => {
    const requestId = (0, uuid_1.v4)().substring(0, 8);
    console.log(`🔐 [${requestId}] OIDC login request received`);
    try {
        if (!oidc_1.oidcService.isConfigured()) {
            console.log(`❌ [${requestId}] OIDC not configured`);
            return res.status(500).json({
                error: 'OIDC authentication not configured. Please set AUTHENTIK_CLIENT_ID and AUTHENTIK_CLIENT_SECRET.'
            });
        }
        const state = (0, uuid_1.v4)();
        const authUrl = oidc_1.oidcService.generateAuthUrl(state);
        console.log(`🔗 [${requestId}] Redirecting to Authentik:`, authUrl);
        res.redirect(authUrl);
    }
    catch (error) {
        console.error(`❌ [${requestId}] OIDC login error:`, error);
        res.status(500).json({ error: 'Failed to initiate OIDC login' });
    }
});
/**
 * @swagger
 * /api/auth/oidc/callback:
 *   get:
 *     summary: OIDC callback handler
 *     description: Handles the callback from Authentik after successful authentication
 *     tags: [Authentication]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Authorization code from Authentik
 *       - in: query
 *         name: state
 *         required: true
 *         schema:
 *           type: string
 *         description: State parameter for CSRF protection
 *     responses:
 *       302:
 *         description: Redirect to frontend with authentication token
 *       400:
 *         description: Missing code or state parameter
 *       500:
 *         description: Authentication failed
 */
router.get('/oidc/callback', async (req, res) => {
    const requestId = (0, uuid_1.v4)().substring(0, 8);
    const { code, state, error } = req.query;
    console.log(`🔄 [${requestId}] OIDC callback received:`, {
        hasCode: !!code,
        hasState: !!state,
        error,
    });
    try {
        if (error) {
            console.log(`❌ [${requestId}] OIDC error:`, error);
            return res.redirect(`http://fuzefront.dev.local/?error=oidc_error&message=${encodeURIComponent(error)}`);
        }
        if (!code || !state) {
            console.log(`❌ [${requestId}] Missing code or state`);
            return res.redirect(`http://fuzefront.dev.local/?error=missing_parameters`);
        }
        // Handle the callback and get user
        const user = await oidc_1.oidcService.handleCallback(code, state);
        console.log(`✅ [${requestId}] User authenticated via OIDC:`, user.email);
        // Generate JWT token
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, process.env.JWT_SECRET, {
            expiresIn: '24h',
        });
        // Create session
        const sessionId = (0, uuid_1.v4)();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        await (0, database_1.db)('sessions').insert({
            id: sessionId,
            user_id: user.id,
            expires_at: expiresAt,
        });
        console.log(`🎉 [${requestId}] OIDC login successful for:`, user.email);
        // Self-heal provisioning in the background (does not block the redirect).
        selfHealProvisioningOnLogin(user.id);
        // Redirect to frontend with token
        const frontendUrl = `http://fuzefront.dev.local/?token=${token}&sessionId=${sessionId}`;
        res.redirect(frontendUrl);
    }
    catch (error) {
        console.error(`❌ [${requestId}] OIDC callback error:`, error);
        res.redirect(`http://fuzefront.dev.local/?error=authentication_failed`);
    }
});
/**
 * @swagger
 * /api/auth/method:
 *   get:
 *     summary: Get available authentication methods
 *     description: Returns which authentication methods are available
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       200:
 *         description: Available authentication methods
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 methods:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["local", "oidc"]
 *                 oidcConfigured:
 *                   type: boolean
 *                 defaultMethod:
 *                   type: string
 */
router.get('/method', (req, res) => {
    const oidcConfigured = oidc_1.oidcService.isConfigured();
    const methods = ['local']; // Always support local auth
    if (oidcConfigured) {
        methods.push('oidc');
    }
    res.json({
        methods,
        oidcConfigured,
        defaultMethod: oidcConfigured ? 'oidc' : 'local',
        oidcLoginUrl: oidcConfigured ? '/api/auth/oidc/login' : null,
    });
});
exports.default = router;
//# sourceMappingURL=auth.js.map