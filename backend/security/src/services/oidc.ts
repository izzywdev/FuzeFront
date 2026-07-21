import { Issuer, Client, generators, custom } from 'openid-client';
import { db } from '../config/database';
import { User } from '../types/shared';
import { defaultEventPublisher } from './eventPublisher';

/**
 * HTTP timeout for every server-side OIDC call (discovery, token grant, userinfo,
 * jwks). openid-client defaults to 3500ms, which is BELOW Authentik's real p99 and
 * broke Google sign-in outright — see the note in initialize(). Overridable via
 * OIDC_HTTP_TIMEOUT_MS so it can be tuned per environment without a rebuild.
 */
const OIDC_HTTP_TIMEOUT_MS = Number(process.env.OIDC_HTTP_TIMEOUT_MS) || 15000;

interface OIDCConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
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

      // Raise openid-client's HTTP timeout. Its default is 3500ms, which is too
      // short for Authentik's token endpoint and silently broke Google sign-in:
      // the browser completed Google auth, the callback arrived with a valid code
      // and state, and the code->token grant then died with
      //   RPError: outgoing request timed out after 3500ms
      // surfacing to the user as ?error=authentication_failed. Authentik averages
      // ~1.3s per request with multi-second spikes, and the grant is several
      // round-trips, so 3.5s is under the real p99. Applied via
      // setHttpOptionsDefaults so it covers discovery, the token grant, userinfo
      // and jwks — not just the one call that happened to fail first.
      custom.setHttpOptionsDefaults({ timeout: OIDC_HTTP_TIMEOUT_MS });

      // Discover the issuer
      const issuer = await Issuer.discover(this.config.issuerUrl);
      console.log('✅ Discovered issuer:', issuer.metadata.issuer);

      // Route the SERVER-SIDE OIDC calls (token / userinfo / jwks) over in-cluster
      // DNS instead of hairpinning out to app.fuzefront.com via Cloudflare (which
      // made login 15-28s and intermittently 401). Safe because the provider's
      // issuer_mode is `per_provider` — the `iss` claim is fixed to the external
      // issuer regardless of the request host, so token validation still matches.
      // The authorization_endpoint stays EXTERNAL (it is browser-facing).
      let effectiveIssuer = issuer;
      const internalBase = process.env.AUTHENTIK_BASE_URL;
      if (internalBase) {
        const toInternal = (u?: string): string | undefined => {
          if (!u) return u;
          try {
            const url = new URL(u);
            const ib = new URL(internalBase);
            url.protocol = ib.protocol;
            url.host = ib.host;
            return url.toString();
          } catch {
            return u;
          }
        };
        effectiveIssuer = new Issuer({
          ...issuer.metadata,
          // Authentik derives `iss` from the request host even in per_provider
          // mode, so a token fetched from authentik-server:9000 carries
          // iss=http://authentik-server:9000/... — expect exactly that. The
          // browser-facing FuzeFront session token is separately HS256-minted, so
          // this internal `iss` never leaves the server.
          issuer: toInternal(issuer.metadata.issuer) as string,
          token_endpoint: toInternal(issuer.metadata.token_endpoint),
          userinfo_endpoint: toInternal(issuer.metadata.userinfo_endpoint),
          jwks_uri: toInternal(issuer.metadata.jwks_uri),
          introspection_endpoint: toInternal(issuer.metadata.introspection_endpoint as string | undefined),
          revocation_endpoint: toInternal(issuer.metadata.revocation_endpoint as string | undefined),
        });
        console.log('✅ OIDC server-side endpoints routed in-cluster via', internalBase);
      }

      // Create the client
      this.client = new effectiveIssuer.Client({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uris: [this.config.redirectUri],
        response_types: ['code'],
        grant_types: ['authorization_code'],
        // Authentik signs ID tokens with HS256 (client-secret-based); without
        // this override openid-client rejects them as "unexpected JWT alg".
        id_token_signed_response_alg: 'HS256',
      });

      console.log('✅ OIDC client initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize OIDC client:', error);
      throw error;
    }
  }

  generateAuthUrl(state?: string): { url: string; codeVerifier: string } {
    if (!this.client) {
      throw new Error('OIDC client not initialized');
    }

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    const url = this.client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: state || generators.state(),
    });

    // Stateless by design: the caller persists `codeVerifier` in an HttpOnly
    // cookie alongside `state`, then hands it back to handleCallback(). The
    // security service runs multiple replicas, so an in-memory map only works
    // on the pod that started the flow — the callback often lands on a different
    // replica and the token exchange then fails with "Code verifier not found"
    // (surfaced to the user as authentication_failed). A cookie round-trips.
    return { url, codeVerifier };
  }

  async handleCallback(
    code: string,
    state: string | undefined,
    codeVerifier: string
  ): Promise<User> {
    if (!this.client) {
      throw new Error('OIDC client not initialized');
    }
    if (!codeVerifier) {
      throw new Error('Code verifier not found');
    }

    try {
      // Exchange code for tokens (PKCE: code_verifier comes from the cookie)
      const tokenSet = await this.client.callback(
        this.config.redirectUri,
        { code, state },
        { code_verifier: codeVerifier, state }
      );

      console.log('✅ Received tokens from Authentik');

      // Get user info
      const userinfo = await this.client.userinfo(tokenSet.access_token!);
      console.log('✅ Retrieved user info:', userinfo);

      // Sync user to local database
      const user = await this.syncUserToDatabase(userinfo);

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
    // Project the provider's email-verification assertion into our local column.
    // The enrollment email-verify stage (or a verified social login) sets the
    // standard OIDC `email_verified` claim; we only ever flip FALSE->TRUE here so
    // a stale/absent claim never un-verifies an already-verified account.
    //
    // Accept the STRING "true" as well as the boolean. The OIDC spec types this
    // as a boolean, but real providers emit `"true"` — and this claim passes
    // through from the upstream social provider (e.g. Google) as well as from our
    // own IdP, so we cannot assume one encoding. A strict `=== true` silently
    // treats a genuinely-verified account as unverified forever: it never gets
    // promoted on login, and the moment REQUIRE_EMAIL_VERIFICATION is switched on
    // that user is locked out of an account they did verify.
    const emailVerifiedClaim =
      userinfo.email_verified === true || userinfo.email_verified === 'true';

    try {
      // Check if user exists
      let userRow = await db('users').where('email', email).first();

      if (userRow) {
        // Update existing user. Only ever promote email_verified FALSE->TRUE.
        await db('users')
          .where('id', userRow.id)
          .update({
            first_name: firstName,
            last_name: lastName,
            ...(emailVerifiedClaim && !userRow.email_verified
              ? { email_verified: true }
              : {}),
            updated_at: new Date(),
          });

        console.log(`✅ Updated existing user: ${email}`);
      } else {
        // Create new user. The local `id` is ALWAYS a generated uuid — never the
        // OIDC `sub`, which Authentik sets to the email/username (not a uuid) and
        // which would fail the uuid-typed `id` column. Email is the natural key we
        // match on (above), so a fresh uuid is safe and stable per-account.
        const newUser = {
          id: require('uuid').v4(),
          email: email,
          first_name: firstName,
          last_name: lastName,
          roles: JSON.stringify(['user']), // Default role
          email_verified: emailVerifiedClaim,
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
        // `roles` is a JSONB column — Postgres returns it already-parsed (an
        // array) for a row read from the DB, but the freshly-inserted in-memory
        // row holds the JSON string. Handle both, or an existing-user login
        // double-parses the array → JSON.parse("user") → "Unexpected token u".
        roles: Array.isArray(userRow.roles)
          ? userRow.roles
          : JSON.parse(userRow.roles || '["user"]'),
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

  isInitialized(): boolean {
    return this.client !== null;
  }
}

export const oidcService = new OIDCService(); 