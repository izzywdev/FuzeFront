"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.oidcService = void 0;
const openid_client_1 = require("openid-client");
const database_1 = require("../config/database");
const eventPublisher_1 = require("./eventPublisher");
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
        const url = this.client.authorizationUrl({
            scope: 'openid email profile',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state: state || openid_client_1.generators.state(),
        });
        // Stateless by design: the caller persists `codeVerifier` in an HttpOnly
        // cookie alongside `state`, then hands it back to handleCallback(). The
        // security service runs multiple replicas, so an in-memory map only works
        // on the pod that started the flow — the callback often lands on a different
        // replica and the token exchange then fails with "Code verifier not found"
        // (surfaced to the user as authentication_failed). A cookie round-trips.
        return { url, codeVerifier };
    }
    async handleCallback(code, state, codeVerifier) {
        if (!this.client) {
            throw new Error('OIDC client not initialized');
        }
        if (!codeVerifier) {
            throw new Error('Code verifier not found');
        }
        try {
            // Exchange code for tokens (PKCE: code_verifier comes from the cookie)
            const tokenSet = await this.client.callback(this.config.redirectUri, { code, state }, { code_verifier: codeVerifier });
            console.log('✅ Received tokens from Authentik');
            // Get user info
            const userinfo = await this.client.userinfo(tokenSet.access_token);
            console.log('✅ Retrieved user info:', userinfo);
            // Sync user to local database
            const user = await this.syncUserToDatabase(userinfo);
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
                // Atomically insert the user AND an outbox row for identity.user.created.
                // The outbox guarantees the event is durably recorded even if the Kafka
                // publish below fails; reconcile-on-login is the ultimate safety net.
                const correlationId = `identity-${newUser.id}`;
                await database_1.db.transaction(async (trx) => {
                    await trx('users').insert(newUser);
                    await trx('event_outbox').insert({
                        id: require('uuid').v4(),
                        topic: 'identity.user.created',
                        payload: JSON.stringify({
                            userId: newUser.id,
                            email,
                            firstName,
                            lastName,
                            intent: 'signup',
                        }),
                        correlation_id: correlationId,
                        status: 'pending',
                        attempts: 0,
                    });
                });
                userRow = newUser;
                console.log(`✅ Created new user: ${email}`);
                // Best-effort publish; failure leaves the outbox row 'pending' for replay.
                try {
                    await eventPublisher_1.defaultEventPublisher.publishIdentityUserCreated({
                        userId: newUser.id,
                        email,
                        firstName,
                        lastName,
                        intent: 'signup',
                    }, correlationId);
                    await (0, database_1.db)('event_outbox')
                        .where({ correlation_id: correlationId })
                        .update({ status: 'sent', attempts: 1, sent_at: new Date() });
                }
                catch (pubErr) {
                    console.error('⚠️ identity.user.created publish failed (outbox retains it):', pubErr);
                }
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