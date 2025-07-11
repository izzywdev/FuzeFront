"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.oidcService = void 0;
const openid_client_1 = require("openid-client");
const database_1 = require("../config/database");
class OIDCService {
    constructor() {
        this.client = null;
        this.config = {
            issuerUrl: process.env.AUTHENTIK_ISSUER_URL || 'http://localhost:9000/application/o/fuzefront/',
            clientId: process.env.AUTHENTIK_CLIENT_ID || '',
            clientSecret: process.env.AUTHENTIK_CLIENT_SECRET || '',
            redirectUri: process.env.AUTHENTIK_REDIRECT_URI || 'http://fuzefront.dev.local/api/auth/oidc/callback',
        };
    }
    async initialize() {
        try {
            console.log('🔧 Initializing OIDC client...');
            // Discover the issuer
            const issuer = await openid_client_1.Issuer.discover(this.config.issuerUrl);
            console.log('✅ Discovered issuer:', issuer.metadata.issuer);
            // Create the client
            this.client = new issuer.Client({
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                redirect_uris: [this.config.redirectUri],
                response_types: ['code'],
                grant_types: ['authorization_code'],
            });
            console.log('✅ OIDC client initialized successfully');
        }
        catch (error) {
            console.error('❌ Failed to initialize OIDC client:', error);
            throw error;
        }
    }
    generateAuthUrl(state) {
        if (!this.client) {
            throw new Error('OIDC client not initialized');
        }
        const codeVerifier = openid_client_1.generators.codeVerifier();
        const codeChallenge = openid_client_1.generators.codeChallenge(codeVerifier);
        const authUrl = this.client.authorizationUrl({
            scope: 'openid email profile',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state: state || openid_client_1.generators.state(),
        });
        // Store code verifier for later use (in production, use Redis or database)
        // For now, we'll store it in memory (not suitable for production)
        if (!global.codeVerifiers) {
            global.codeVerifiers = new Map();
        }
        global.codeVerifiers.set(state || 'default', codeVerifier);
        return authUrl;
    }
    async handleCallback(code, state) {
        if (!this.client) {
            throw new Error('OIDC client not initialized');
        }
        try {
            // Get the stored code verifier
            const codeVerifier = global.codeVerifiers?.get(state || 'default');
            if (!codeVerifier) {
                throw new Error('Code verifier not found');
            }
            // Exchange code for tokens
            const tokenSet = await this.client.callback(this.config.redirectUri, { code, state }, { code_verifier: codeVerifier });
            console.log('✅ Received tokens from Authentik');
            // Get user info
            const userinfo = await this.client.userinfo(tokenSet.access_token);
            console.log('✅ Retrieved user info:', userinfo);
            // Sync user to local database
            const user = await this.syncUserToDatabase(userinfo);
            // Clean up code verifier
            global.codeVerifiers?.delete(state || 'default');
            return user;
        }
        catch (error) {
            console.error('❌ OIDC callback error:', error);
            throw error;
        }
    }
    async syncUserToDatabase(userinfo) {
        const email = userinfo.email;
        const firstName = userinfo.given_name || userinfo.name?.split(' ')[0] || 'User';
        const lastName = userinfo.family_name || userinfo.name?.split(' ').slice(1).join(' ') || '';
        try {
            // Check if user exists
            let userRow = await (0, database_1.db)('users').where('email', email).first();
            if (userRow) {
                // Update existing user
                await (0, database_1.db)('users')
                    .where('id', userRow.id)
                    .update({
                    first_name: firstName,
                    last_name: lastName,
                    updated_at: new Date(),
                });
                console.log(`✅ Updated existing user: ${email}`);
            }
            else {
                // Create new user
                const newUser = {
                    id: userinfo.sub || require('uuid').v4(),
                    email: email,
                    first_name: firstName,
                    last_name: lastName,
                    roles: JSON.stringify(['user']), // Default role
                    created_at: new Date(),
                    updated_at: new Date(),
                };
                await (0, database_1.db)('users').insert(newUser);
                userRow = newUser;
                console.log(`✅ Created new user: ${email}`);
            }
            // Return user object
            const user = {
                id: userRow.id,
                email: userRow.email,
                firstName: userRow.first_name,
                lastName: userRow.last_name,
                roles: JSON.parse(userRow.roles || '["user"]'),
            };
            return user;
        }
        catch (error) {
            console.error('❌ Error syncing user to database:', error);
            throw error;
        }
    }
    isConfigured() {
        return !!(this.config.clientId && this.config.clientSecret);
    }
}
exports.oidcService = new OIDCService();
//# sourceMappingURL=oidc.js.map