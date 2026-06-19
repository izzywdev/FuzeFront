import { Issuer, Client, generators } from 'openid-client';
import { db } from '../config/database';
import { User } from '../types/shared';
import { defaultEventPublisher } from './eventPublisher';

interface OIDCConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// Declare global types for code verifier storage
declare global {
  // `var` is required here — global augmentation can't use let/const.
  // eslint-disable-next-line no-var
  var codeVerifiers: Map<string, string> | undefined;
}

class OIDCService {
  private client: Client | null = null;
  private config: OIDCConfig;

  constructor() {
    this.config = {
      issuerUrl: process.env.AUTHENTIK_ISSUER_URL || 'http://localhost:9000/application/o/fuzefront/',
      clientId: process.env.AUTHENTIK_CLIENT_ID || '',
      clientSecret: process.env.AUTHENTIK_CLIENT_SECRET || '',
      redirectUri: process.env.AUTHENTIK_REDIRECT_URI || 'http://fuzefront.dev.local/api/auth/oidc/callback',
    };
  }

  async initialize(): Promise<void> {
    try {
      console.log('🔧 Initializing OIDC client...');
      
      // Discover the issuer
      const issuer = await Issuer.discover(this.config.issuerUrl);
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
    } catch (error) {
      console.error('❌ Failed to initialize OIDC client:', error);
      throw error;
    }
  }

  generateAuthUrl(state?: string): string {
    if (!this.client) {
      throw new Error('OIDC client not initialized');
    }

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    const authUrl = this.client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: state || generators.state(),
    });

    // Store code verifier for later use (in production, use Redis or database)
    // For now, we'll store it in memory (not suitable for production)
    if (!global.codeVerifiers) {
      global.codeVerifiers = new Map();
    }
    global.codeVerifiers.set(state || 'default', codeVerifier);

    return authUrl;
  }

  async handleCallback(code: string, state?: string): Promise<User> {
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
      const tokenSet = await this.client.callback(
        this.config.redirectUri,
        { code, state },
        { code_verifier: codeVerifier }
      );

      console.log('✅ Received tokens from Authentik');

      // Get user info
      const userinfo = await this.client.userinfo(tokenSet.access_token!);
      console.log('✅ Retrieved user info:', userinfo);

      // Sync user to local database
      const user = await this.syncUserToDatabase(userinfo);

      // Clean up code verifier
      global.codeVerifiers?.delete(state || 'default');

      return user;
    } catch (error) {
      console.error('❌ OIDC callback error:', error);
      throw error;
    }
  }

  private async syncUserToDatabase(userinfo: any): Promise<User> {
    const email = userinfo.email;
    const firstName = userinfo.given_name || userinfo.name?.split(' ')[0] || 'User';
    const lastName = userinfo.family_name || userinfo.name?.split(' ').slice(1).join(' ') || '';

    try {
      // Check if user exists
      let userRow = await db('users').where('email', email).first();

      if (userRow) {
        // Update existing user
        await db('users')
          .where('id', userRow.id)
          .update({
            first_name: firstName,
            last_name: lastName,
            updated_at: new Date(),
          });

        console.log(`✅ Updated existing user: ${email}`);
      } else {
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
        await db.transaction(async trx => {
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
          await defaultEventPublisher.publishIdentityUserCreated(
            {
              userId: newUser.id,
              email,
              firstName,
              lastName,
              intent: 'signup',
            },
            correlationId
          );
          await db('event_outbox')
            .where({ correlation_id: correlationId })
            .update({ status: 'sent', attempts: 1, sent_at: new Date() });
        } catch (pubErr) {
          console.error('⚠️ identity.user.created publish failed (outbox retains it):', pubErr);
        }
      }

      // Return user object
      const user: User = {
        id: userRow.id,
        email: userRow.email,
        firstName: userRow.first_name,
        lastName: userRow.last_name,
        roles: JSON.parse(userRow.roles || '["user"]'),
      };

      return user;
    } catch (error) {
      console.error('❌ Error syncing user to database:', error);
      throw error;
    }
  }

  isConfigured(): boolean {
    return !!(this.config.clientId && this.config.clientSecret);
  }
}

export const oidcService = new OIDCService(); 