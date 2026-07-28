/**
 * Integration tests against FuzeInfra's REAL stub provider — not a mock of it.
 *
 * The stub is the same FastAPI service that runs in production, with
 * `PROVIDER=stub`: it returns Cloudflare-shaped records and walks the real
 * four-state lifecycle (`pending_validation → pending_issuance →
 * pending_deployment → active`) on a timer. Testing against it means our
 * polling loop, error branching, and status projection are exercised by the
 * actual contract implementation rather than by our own idea of it — a
 * hand-rolled mock would happily agree with a wrong assumption.
 *
 * Start it with:
 *
 *   cd <FuzeInfra>/services/custom-hostname-api
 *   pip install -r requirements.txt
 *   PROVIDER=stub ROUTING_ENABLED=false \
 *     ROUTE_PROFILES='- {name: fuzefront, namespace: fuzefront, service: fuzefront-frontend, port: 80, tokenEnv: T}' \
 *     T=local-dev-token uvicorn app.main:app --port 8099
 *
 * then `CUSTOM_HOSTNAME_STUB_URL=http://127.0.0.1:8099 npm test`.
 *
 * Skipped (not failed) when the stub is unreachable, so the unit suite still
 * runs in a bare checkout. CI stands the stub up and sets
 * `CUSTOM_HOSTNAME_STUB_REQUIRED=1`, which turns an unreachable stub into a
 * hard failure — a suite that silently passes because its subject was down is
 * a green check that proves nothing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { CustomHostnameClient } from '../src/client';
import { CustomHostnameApiError } from '../src/errors';
import {
  isAdvertisable,
  isTerminal,
  orderedVerificationRecords,
  recordPurpose,
} from '../src/status';

const BASE_URL = process.env.CUSTOM_HOSTNAME_STUB_URL ?? 'http://127.0.0.1:8099';
const TOKEN = process.env.CUSTOM_HOSTNAME_STUB_TOKEN ?? 'local-dev-token';

/** The stub walks its lifecycle over ~5s; allow generous headroom on slow CI. */
const ACTIVATION_TIMEOUT_MS = 60_000;

/** CI sets this so an unreachable stub fails loudly instead of skipping. */
const STUB_REQUIRED = process.env.CUSTOM_HOSTNAME_STUB_REQUIRED === '1';

let reachable = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE_URL}/readyz`, {
      signal: AbortSignal.timeout(2000),
    });
    reachable = res.ok;
  } catch {
    reachable = false;
  }
  if (!reachable && STUB_REQUIRED) {
    throw new Error(
      `CUSTOM_HOSTNAME_STUB_REQUIRED=1 but the stub at ${BASE_URL} is unreachable. ` +
        'Refusing to report green for a suite that never ran.'
    );
  }
  if (!reachable) {
    console.warn(
      `[custom-hostname] stub unreachable at ${BASE_URL} — integration tests skipped. ` +
        'Start it per the header comment to exercise the real contract.'
    );
  }
});

const client = () => new CustomHostnameClient({ baseUrl: BASE_URL, token: TOKEN });

/** Unique per run so repeated runs never collide in the stub's JSON store. */
const uniqueDomain = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}.corpabc.test`;

describe('custom hostname API — against FuzeInfra stub', () => {
  it('rejects a domain inside fuzefront.com with 422 validation_error', async () => {
    if (!reachable) return;
    // These are already served by the static wildcard Ingress rule. Sending
    // one would burn Cloudflare quota and shadow the wildcard certificate.
    const err = await client()
      .createCustomHostname('tenant.fuzefront.com')
      .then(() => null)
      .catch((e) => e as CustomHostnameApiError);

    expect(err).toBeInstanceOf(CustomHostnameApiError);
    expect(err!.status).toBe(422);
    // Branch on the stable code, never on the prose message.
    expect(err!.code).toBe('validation_error');
    expect(err!.isValidationError).toBe(true);
  });

  it('returns 401 unauthorized for a bad bearer token', async () => {
    if (!reachable) return;
    const bad = new CustomHostnameClient({ baseUrl: BASE_URL, token: 'not-the-token' });
    const err = await bad
      .listCustomHostnames()
      .then(() => null)
      .catch((e) => e as CustomHostnameApiError);

    expect(err).toBeInstanceOf(CustomHostnameApiError);
    expect(err!.code).toBe('unauthorized');
  });

  it('is idempotent: re-POSTing a known domain returns the existing record', async () => {
    if (!reachable) return;
    const domain = uniqueDomain('idem');
    const first = await client().createCustomHostname(domain);
    const second = await client().createCustomHostname(domain);

    expect(second.domain).toBe(domain);
    // Same record, not a new one — this is what makes a reconcile loop safe to
    // re-run, and what makes re-POST the documented retry for a failed cert.
    expect(second.created_at).toBe(first.created_at);
    expect(second.provider?.id).toBe(first.provider?.id);
  });

  it('returns 204 when deleting a domain that was never registered', async () => {
    if (!reachable) return;
    // Idempotent by contract, so best-effort cleanup never needs a pre-check.
    await expect(
      client().deleteCustomHostname('never-registered-anywhere.example.com')
    ).resolves.toBeUndefined();
  });

  it('surfaces all three verification records, ordered and labelled', async () => {
    if (!reachable) return;
    const domain = uniqueDomain('records');
    const created = await client().createCustomHostname(domain);
    const records = orderedVerificationRecords(created);

    expect(records).toHaveLength(3);
    expect(records.map(recordPurpose)).toEqual([
      'ownership',
      'certificate',
      'routing',
    ]);

    const [ownership, certificate, routing] = records;
    expect(ownership.method).toBe('txt');
    expect(ownership.record).toBe(`_cf-custom-hostname.${domain}`);
    expect(certificate.method).toBe('txt');
    expect(certificate.record).toBe(`_acme-challenge.${domain}`);
    expect(routing.method).toBe('cname');
    expect(routing.record).toBe(domain);
    expect(routing.value).toBe('connect.fuzefront.com');

    // The top-level method/record/value mirror the OWNERSHIP record only —
    // a UI that renders just those would silently omit two records the
    // customer must publish.
    expect(created.verification.record).toBe(ownership.record);
    expect(created.verification.value).toBe(ownership.value);
  });

  it('drives pending → active through the real four-state lifecycle', async () => {
    if (!reachable) return;
    const domain = uniqueDomain('lifecycle');
    const created = await client().createCustomHostname(domain);

    // A freshly-created domain must NEVER be advertisable.
    expect(created.tls_status).toBe('pending_validation');
    expect(created.dns_status).toBe('pending');
    expect(isAdvertisable(created)).toBe(false);
    expect(isTerminal(created)).toBe(false);

    const seen = new Set<string>([created.tls_status]);
    const deadline = Date.now() + ACTIVATION_TIMEOUT_MS;
    let latest = created;

    while (Date.now() < deadline && !isTerminal(latest)) {
      await new Promise((r) => setTimeout(r, 1000));
      latest = await client().getCustomHostname(domain);
      seen.add(latest.tls_status);
    }

    expect(isAdvertisable(latest)).toBe(true);
    expect(latest.tls_status).toBe('active');
    expect(latest.dns_status).toBe('active');

    // The intermediate states are real, not skipped — this is what makes the
    // stub worth testing against rather than mocking.
    expect(seen.has('pending_validation')).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  }, ACTIVATION_TIMEOUT_MS + 10_000);

  it('scopes GET to our own domains and 404s an unknown one', async () => {
    if (!reachable) return;
    const err = await client()
      .getCustomHostname('someone-elses-domain.example.com')
      .then(() => null)
      .catch((e) => e as CustomHostnameApiError);

    expect(err).toBeInstanceOf(CustomHostnameApiError);
    expect(err!.code).toBe('not_found');
  });
});
