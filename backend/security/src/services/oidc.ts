import { Issuer, Client, generators, custom } from 'openid-client';
import { db } from '../config/database';
import { User } from '../types/shared';
import { defaultEventPublisher } from './eventPublisher';
import { logger } from '../lib/logger';
import { AuthentikTenant, allTenants, currentTenant, runWithTenant } from '../providers/authentik/tenants';

/**
 * HTTP timeout for every server-side OIDC call (discovery, token grant, userinfo,
 * jwks). openid-client defaults to 3500ms, which is BELOW Authentik's real p99 and
 * broke Google sign-in outright — see the note in initialize(). Overridable via
 * OIDC_HTTP_TIMEOUT_MS so it can be tuned per environment without a rebuild.
 */
const OIDC_HTTP_TIMEOUT_MS = Number(process.env.OIDC_HTTP_TIMEOUT_MS) || 15000;

/**
 * Cooldown between init ATTEMPTS once one has failed. Without this, every
 * request that lands while Authentik is down would each kick off a fresh
 * discovery call — a self-inflicted retry storm against a service that is
 * already struggling. A short cooldown lets the lazy re-init in
 * ensureInitialized() fail fast (throwing the same error callers already
 * handle) between attempts, while the background loop below keeps making
 * slower, backed-off attempts in parallel.
 */
const OIDC_INIT_COOLDOWN_MS = Number(process.env.OIDC_INIT_COOLDOWN_MS) || 7000;

/** Background re-init backoff bounds: starts fast, caps so a hard-down
 * Authentik doesn't get hammered for the life of the process. */
const OIDC_BACKGROUND_RETRY_INITIAL_MS = Number(process.env.OIDC_BACKGROUND_RETRY_INITIAL_MS) || 1000;
const OIDC_BACKGROUND_RETRY_MAX_MS = Number(process.env.OIDC_BACKGROUND_RETRY_MAX_MS) || 60_000;

interface OIDCConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

class OIDCService {
  private client: Client | null = null;
  private config: OIDCConfig;

  // Lazy/background re-init bookkeeping. `initPromise` is shared by every
  // caller currently attempting init (request path AND background loop) so a
  // burst of concurrent requests against an uninitialized client produces
  // exactly ONE discovery call, not one per request.
  private initPromise: Promise<void> | null = null;
  private lastInitAttemptAt = 0;
  private backgroundRetryStarted = false;

  /**
   * ONE INSTANCE PER TENANT. The config comes from the tenant, not from
   * process.env: each tenant is backed by its own Authentik instance, so a
   * shared client would run discovery against one directory and then validate
   * the other's tokens against those keys. The discovery cache, the init
   * cooldown and the background retry loop are all per-instance for the same
   * reason — one tenant's Authentik being down must not mark another's client
   * as failed, or leave it serving a stale issuer.
   */
  constructor(private readonly tenant: AuthentikTenant) {
    this.config = {
      issuerUrl: tenant.issuerUrl,
      clientId: tenant.clientId,
      clientSecret: tenant.clientSecret,
      redirectUri: tenant.redirectUri,
    };
  }

  /** Tenant this client serves — used for log correlation and cache keying. */
  get tenantId(): string {
    return this.tenant.id;
  }

  async initialize(): Promise<void> {
    try {
      logger.info('oidc: initializing client');

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
      logger.info({ issuer: issuer.metadata.issuer }, 'oidc: discovered issuer');

      // Route the SERVER-SIDE OIDC calls (token / userinfo / jwks) over in-cluster
      // DNS instead of hairpinning out to app.fuzefront.com via Cloudflare (which
      // made login 15-28s and intermittently 401). Safe because the provider's
      // issuer_mode is `per_provider` — the `iss` claim is fixed to the external
      // issuer regardless of the request host, so token validation still matches.
      // The authorization_endpoint stays EXTERNAL (it is browser-facing).
      let effectiveIssuer = issuer;
      // Per-tenant in-cluster base. Reading this from the tenant rather than
      // the environment is what keeps each tenant's server-side calls pointed
      // at ITS OWN authentik Service (authentik-server vs
      // authentik-mendys-server) instead of whichever one the process happened
      // to be configured with.
      const internalBase = this.tenant.baseUrl || undefined;
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
        logger.info({ internalBase }, 'oidc: server-side endpoints routed in-cluster');
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

      logger.info('oidc: client initialized successfully');
    } catch (error) {
      logger.error({ err: (error as Error).message }, 'oidc: failed to initialize client');
      throw error;
    }
  }

  /**
   * Kick off (or join) a single init attempt, honoring the cooldown. Shared by
   * both the on-demand lazy path (ensureInitialized) and the background retry
   * loop (startBackgroundRetry) so the two never race each other into a
   * double discovery call.
   *
   * Returns the in-flight/most-recent attempt's promise, or `null` if no
   * attempt was made because we're still within the cooldown window from the
   * last failure (caller decides what to do — lazy path fails fast, the
   * background loop just waits for the next tick).
   */
  private attemptInit(): Promise<void> | null {
    if (this.client) {
      return Promise.resolve();
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    const now = Date.now();
    if (now - this.lastInitAttemptAt < OIDC_INIT_COOLDOWN_MS) {
      return null;
    }
    this.lastInitAttemptAt = now;
    const attemptStart = now;
    this.initPromise = this.initialize()
      .then(() => {
        logger.info(
          { elapsedMs: Date.now() - attemptStart },
          'oidc: re-init succeeded'
        );
      })
      .catch(error => {
        logger.warn(
          { err: (error as Error).message, elapsedMs: Date.now() - attemptStart },
          'oidc: re-init attempt failed'
        );
        throw error;
      })
      .finally(() => {
        this.initPromise = null;
      });
    return this.initPromise;
  }

  /**
   * Lazy re-init on demand: called by request-path callers that find the
   * client uninitialized. Multiple concurrent callers share the same
   * in-flight promise (no stampede). If we're within the post-failure
   * cooldown, this fails fast with the existing error rather than issuing a
   * fresh discovery call per request — the background loop is what keeps
   * trying between requests.
   */
  async ensureInitialized(): Promise<void> {
    if (this.client) return;
    const attempt = this.attemptInit();
    if (!attempt) {
      throw new Error('OIDC client not initialized');
    }
    await attempt;
  }

  /**
   * Background self-heal: capped exponential backoff (1s -> 60s) for the life
   * of the process, so the service recovers within about a minute of
   * Authentik coming back even with zero request traffic. Idempotent — safe
   * to call from multiple boot paths. Stops once initialized; nothing in this
   * service currently un-initializes the client, so there's nothing further
   * to self-heal after that.
   */
  startBackgroundRetry(): void {
    if (this.backgroundRetryStarted) return;
    this.backgroundRetryStarted = true;

    const run = async () => {
      let delayMs = OIDC_BACKGROUND_RETRY_INITIAL_MS;
      while (!this.client) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        if (this.client) return;

        const attempt = this.attemptInit();
        if (!attempt) {
          // Still cooling down from a very recent attempt (e.g. a request
          // triggered one moments ago) — just wait for the next tick rather
          // than busy-looping.
          continue;
        }
        try {
          await attempt;
          logger.info('oidc: background re-init succeeded, self-heal complete');
          return;
        } catch {
          delayMs = Math.min(delayMs * 2, OIDC_BACKGROUND_RETRY_MAX_MS);
          logger.warn({ nextRetryMs: delayMs }, 'oidc: background re-init failed, backing off');
        }
      }
    };

    run().catch(error => {
      // Should be unreachable (the loop only throws are caught internally),
      // but never let a rejected background promise become an unhandled
      // rejection that could crash the process.
      logger.error({ err: (error as Error).message }, 'oidc: background retry loop crashed');
    });
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
      // Lazy re-init: the callback can legitimately land after the client
      // dropped/never came up (Authentik was briefly down). Preserve the
      // exact error type/message on failure so callers' existing handling
      // is unchanged.
      await this.ensureInitialized();
    }
    if (!codeVerifier) {
      throw new Error('Code verifier not found');
    }

    try {
      // Exchange code for tokens (PKCE: code_verifier comes from the cookie).
      // Timed individually: openid-client honours the global
      // custom.setHttpOptionsDefaults({ timeout }) set in initialize(), so a
      // stuck token/userinfo call fails at OIDC_HTTP_TIMEOUT_MS rather than
      // hanging — the elapsed logs pinpoint which of the two stalled.
      const tokenStart = Date.now();
      const tokenSet = await this.client.callback(
        this.config.redirectUri,
        { code, state },
        { code_verifier: codeVerifier, state }
      );
      logger.info(
        { elapsedMs: Math.round(Date.now() - tokenStart) },
        'oidc: token exchange completed'
      );

      // Claims come from the ID TOKEN, not a second HTTP call.
      //
      // A sign-in is a chain of SEQUENTIAL round-trips to the identity provider
      // (flow-executor stages, then authorize -> code, then this token
      // exchange), and Authentik averages ~1.3s per request with multi-second
      // spikes — so the round-trip COUNT is the dominant cost, and a redundant
      // one is pure added latency on every single login.
      //
      // `userinfo` was exactly that. The provider blueprint sets
      // `include_claims_in_id_token: true` and grants the `openid email
      // profile` scope mappings we request, so the ID token already carries
      // every field syncUserToDatabase reads: email, email_verified, name,
      // given_name (see deploy/helm/.../blueprints/provider-oidc.yaml). The
      // extra endpoint call re-fetched data we were already holding.
      //
      // Trust: `client.callback()` has already verified the ID token's
      // signature, issuer, audience and expiry, so these claims are no less
      // authoritative than the userinfo response — same provider, same
      // mappings, one fewer hop.
      //
      // FALL BACK, don't assume. If `include_claims_in_id_token` is ever turned
      // off, or a provider is configured without the profile/email mappings,
      // `email` will be missing — and email is the natural key user sync
      // matches on, so guessing would create duplicate accounts. Absent email
      // means we still make the userinfo call rather than proceed on partial
      // data.
      const claimsStart = Date.now();
      let userinfo: Record<string, unknown> = {};
      try {
        userinfo = tokenSet.claims() as Record<string, unknown>;
      } catch (err) {
        // A malformed/absent id_token should not be fatal — the fallback below
        // covers it.
        logger.warn(
          { err: (err as Error).message },
          'oidc: could not read id_token claims; falling back to userinfo'
        );
      }
      if (!userinfo.email) {
        const userinfoStart = Date.now();
        userinfo = (await this.client.userinfo(
          tokenSet.access_token!
        )) as Record<string, unknown>;
        logger.info(
          { elapsedMs: Math.round(Date.now() - userinfoStart) },
          'oidc: userinfo retrieved (id_token carried no email)'
        );
      } else {
        logger.info(
          { elapsedMs: Math.round(Date.now() - claimsStart) },
          'oidc: claims read from id_token (userinfo round-trip skipped)'
        );
      }

      // Sync user to local database
      const syncStart = Date.now();
      const user = await this.syncUserToDatabase(userinfo);
      logger.info(
        { elapsedMs: Math.round(Date.now() - syncStart) },
        'oidc: user sync completed'
      );

      return user;
    } catch (error) {
      logger.error({ err: (error as Error).message }, 'oidc: callback error');
      throw error;
    }
  }

  private async syncUserToDatabase(userinfo: any): Promise<User> {
    return syncUserToDatabase(userinfo);
  }

  isConfigured(): boolean {
    return !!(this.config.clientId && this.config.clientSecret);
  }

  isInitialized(): boolean {
    return this.client !== null;
  }
}

/**
 * Project an OIDC/social `userinfo` (or validated id_token claims) into the local
 * `users` table, emitting `identity.user.created` for a fresh account.
 *
 * Extracted from the OIDC callback so the SERVER-BROKERED Google path
 * (`googleOidcService` → `AuthentikIdentityProvider.brokerCallback`) creates the
 * SAME synced projection and emits the SAME event as the classic OIDC callback —
 * one code path, no divergence. `email`, `given_name`/`family_name`/`name`, and
 * `email_verified` follow the standard OIDC claim shapes Google also emits.
 */
export async function syncUserToDatabase(userinfo: any): Promise<User> {
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

        logger.debug({ email }, 'oidc: updated existing user');
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

        logger.info({ email, userId: newUser.id }, 'oidc: created new user');

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
          logger.error(
            { email, userId: newUser.id, correlationId, err: (pubErr as Error).message },
            'oidc: identity.user.created publish failed (outbox retains it)'
          );
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
      logger.error({ err: (error as Error).message }, 'oidc: error syncing user to database');
      throw error;
    }
}

/**
 * One OIDCService per tenant, keyed by tenant id and created on first use.
 *
 * Keyed by id rather than by host: several hosts may map to one tenant
 * (live./marketplace.mendysrobotics.com), and they must share a single
 * discovery cache and a single init/backoff state rather than racing each
 * other into duplicate discovery calls.
 */
const byTenant = new Map<string, OIDCService>();

/**
 * Structural type of the OIDC client, so consumers can depend on the shape
 * (and inject fakes in tests) without importing the class or being bound to a
 * particular tenant's instance.
 */
export type OIDCServiceLike = OIDCService;

/** The OIDC client for an explicit tenant. */
export function getOidcServiceFor(tenant: AuthentikTenant): OIDCService {
  let svc = byTenant.get(tenant.id);
  if (!svc) {
    svc = new OIDCService(tenant);
    byTenant.set(tenant.id, svc);
  }
  return svc;
}

/**
 * The OIDC client for the tenant serving the current request.
 *
 * Replaces the former `oidcService` singleton, which was constructed at import
 * time from process.env and therefore could only ever address one Authentik.
 * Throws outside a tenant context rather than guessing — see tenants.ts.
 */
export function getOidcService(): OIDCService {
  return getOidcServiceFor(currentTenant('OIDC client'));
}

/** Drop the per-tenant instances. Tests only. */
export function resetOidcServicesForTests(): void {
  byTenant.clear();
}

/**
 * Warm every configured tenant at boot: initialise its client and start its
 * self-heal loop. Previously this was a single implicit client; with several
 * tenants each needs its own, and one tenant's Authentik being down must not
 * prevent the others from coming up — so failures are logged, not thrown.
 */
export async function initializeAllTenants(): Promise<void> {
  await Promise.all(
    allTenants().map(async (tenant) => {
      const svc = getOidcServiceFor(tenant);
      try {
        await runWithTenant(tenant, () => svc.initialize());
        logger.info({ tenant: tenant.id }, 'oidc: tenant client initialized');
      } catch (error) {
        logger.warn(
          { tenant: tenant.id, err: (error as Error).message },
          'oidc: tenant client failed to initialize; background retry will self-heal'
        );
      } finally {
        svc.startBackgroundRetry();
      }
    })
  );
}