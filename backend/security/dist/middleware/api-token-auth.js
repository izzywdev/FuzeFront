"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenAuthRateLimiter = void 0;
exports.authenticateFlexible = authenticateFlexible;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_1 = require("./auth");
const api_token_1 = require("../services/api-token");
const database_1 = require("../config/database");
// ---------------------------------------------------------------------------
// Rate limiter — counts only FAILED token-auth attempts (non-2xx responses)
// ---------------------------------------------------------------------------
/**
 * Apply this limiter to routes that accept ff_live_ tokens.
 * Only failed (non-2xx) responses increment the counter, so legitimate
 * traffic is never throttled. The 11th failed attempt within 60 s returns 429.
 */
exports.tokenAuthRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many failed authentication attempts, please try again later' },
});
// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
/**
 * authenticateFlexible — express middleware that accepts JWT or API token.
 *
 * If the bearer token starts with "ff_live_" it is treated as an API token
 * and verified via the token service. Otherwise the JWT path is taken by
 * delegating to core's authenticateToken unchanged.
 */
async function authenticateFlexible(req, res, next) {
    const authHeader = req.headers.authorization;
    const value = authHeader?.split(' ')[1];
    if (!value) {
        res.status(401).json({ error: 'No token provided' });
        return;
    }
    // JWT path — delegate to core middleware unchanged
    if (!value.startsWith('ff_live_')) {
        (0, auth_1.authenticateToken)(req, res, next);
        return;
    }
    // API-token path
    const result = await (0, api_token_1.verifyToken)(value);
    if (result.status === 'invalid') {
        res.status(401).json({ error: 'Invalid token' });
        return;
    }
    if (result.status === 'revoked') {
        res.status(401).json({ error: 'Token revoked' });
        return;
    }
    if (result.status === 'expired') {
        res.status(401).json({ error: 'Token expired' });
        return;
    }
    // result.status === 'valid'
    const { token } = result;
    if (token.owner_type === 'user') {
        // PAT: load the user row so req.user mirrors the shape core builds
        const userRow = await database_1.db('users')
            .select('id', 'email', 'first_name', 'last_name', 'roles')
            .where({ id: token.owner_id })
            .first();
        if (!userRow) {
            res.status(401).json({ error: 'Token owner not found' });
            return;
        }
        req.user = {
            id: userRow.id,
            email: userRow.email,
            firstName: userRow.first_name ?? undefined,
            lastName: userRow.last_name ?? undefined,
            roles: Array.isArray(userRow.roles) ? userRow.roles : [],
        };
    }
    else {
        // Service token (owner_type === 'org'): synthetic principal
        // Permit principal key: "svc_token:<token.id>"
        req.user = {
            id: `svc_token:${token.id}`,
            email: '',
            firstName: '',
            lastName: '',
            roles: ['service'],
        };
    }
    req.apiToken = {
        id: token.id,
        scopes: token.scopes,
        ownerType: token.owner_type,
        ownerId: token.owner_id,
    };
    // Fire-and-forget — must not block the request
    (0, api_token_1.updateLastUsed)(token.id).catch((err) => {
        console.error('[api-token-auth] updateLastUsed failed for prefix=%s: %s', token.token_prefix, err);
    });
    next();
}
//# sourceMappingURL=api-token-auth.js.map