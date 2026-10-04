// events.seed-consumers.unit.test.ts - the pure pieces of the seeding consumers (no database):
// attestation verdict mapping (refusal vs retry), token hygiene, the bounded retry budget, the
// DLQ redaction helper. The end-to-end behaviour is tests/seed.consumers.db.test.ts.

import { ServiceAuthError } from '@fuzefront/service-auth';
import type { MachineIdentity, MachineTokenVerifier } from '@fuzefront/service-auth';
import { _setAttestationVerifierForTesting, AttestationUnavailableError, verifySeedAttestation } from '../src/events/attestation';
import { RetryBudget } from '../src/events/retryBudget';
import { redactSeedRequest } from '../src/events/seed-requested.handler';

const TOKEN = 'secret-bearer-token-ZZZ999';

const identity = (over: Partial<MachineIdentity> = {}): MachineIdentity => ({
  subject: 'fuzecrm-service',
  tenantId: null,
  scope: 'selection-lists:seed',
  scopes: ['selection-lists:seed'],
  expiresAt: Math.floor(Date.now() / 1000) + 60,
  raw: { active: true } as never,
  ...over,
});
const verifierThat = (fn: (token: string) => Promise<MachineIdentity>): MachineTokenVerifier => ({ verifyMachineToken: fn });

afterEach(() => _setAttestationVerifierForTesting(null));

describe('verifySeedAttestation', () => {
  it('accepts an active token carrying the seed scope and returns the introspected subject', async () => {
    _setAttestationVerifierForTesting(verifierThat(async () => identity()));
    await expect(verifySeedAttestation(TOKEN)).resolves.toEqual({ ok: true, subject: 'fuzecrm-service' });
  });

  it('accepts the seed scope among others (the verifier splits the scope string)', async () => {
    _setAttestationVerifierForTesting(verifierThat(async () => identity({ scopes: ['openid', 'selection-lists:seed'] })));
    await expect(verifySeedAttestation(TOKEN)).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ['no scopes', { scopes: [] as string[] }],
    ['a broader but different scope (authz:admin never stands in for the seed scope)', { scopes: ['authz:admin'] }],
    ['a scope that merely CONTAINS the seed scope', { scopes: ['selection-lists:seed-admin'] }],
    ['an expired exp even though introspection said active', { expiresAt: Math.floor(Date.now() / 1000) - 1 }],
    ['an empty subject', { subject: '' }],
  ])('refuses (ok:false) a token with %s', async (_label, over) => {
    _setAttestationVerifierForTesting(verifierThat(async () => identity(over as Partial<MachineIdentity>)));
    const v = await verifySeedAttestation(TOKEN);
    expect(v.ok).toBe(false);
    expect(JSON.stringify(v)).not.toContain(TOKEN);
  });

  it.each(['TOKEN_INACTIVE', 'NO_TOKEN'] as const)('%s is a REFUSAL (ATTESTATION_INVALID upstream), never a retry', async (code) => {
    _setAttestationVerifierForTesting(
      verifierThat(async () => {
        throw new ServiceAuthError(code, 'Token is not active.', 401);
      }),
    );
    const v = await verifySeedAttestation(TOKEN);
    expect(v).toMatchObject({ ok: false });
    expect(JSON.stringify(v)).not.toContain(TOKEN);
  });

  it.each(['INTROSPECTION_UNAVAILABLE', 'MALFORMED_RESPONSE', 'MISCONFIGURED', 'UNKNOWN'] as const)(
    '%s means "could not decide": it THROWS AttestationUnavailableError (retry), fail closed, and the message carries the code only',
    async (code) => {
      _setAttestationVerifierForTesting(
        verifierThat(async () => {
          // a hostile/careless inner error that echoes the token must not leak through our wrapper
          throw new ServiceAuthError(code, `request failed for ${TOKEN}`, 401);
        }),
      );
      const err = await verifySeedAttestation(TOKEN).catch((e) => e);
      expect(err).toBeInstanceOf(AttestationUnavailableError);
      expect(err.message).toContain(code);
      expect(err.message).not.toContain(TOKEN);
      expect(String(err.stack)).not.toContain(TOKEN);
    },
  );

  it('a non-ServiceAuthError failure is also "could not decide" (fail closed, retried), never a pass', async () => {
    _setAttestationVerifierForTesting(
      verifierThat(async () => {
        throw new TypeError(`boom ${TOKEN}`);
      }),
    );
    const err = await verifySeedAttestation(TOKEN).catch((e) => e);
    expect(err).toBeInstanceOf(AttestationUnavailableError);
    expect(err.message).not.toContain(TOKEN);
  });
});

describe('RetryBudget', () => {
  it('counts attempts per key and marks the one that exhausts the budget as last', () => {
    const b = new RetryBudget(3);
    expect(b.next('a')).toEqual({ attempt: 1, last: false });
    expect(b.next('a')).toEqual({ attempt: 2, last: false });
    expect(b.next('a')).toEqual({ attempt: 3, last: true });
    expect(b.next('b')).toEqual({ attempt: 1, last: false });
  });

  it('clear() forgets a key (a handled message does not carry old attempts)', () => {
    const b = new RetryBudget(2);
    b.next('a');
    b.clear('a');
    expect(b.next('a')).toEqual({ attempt: 1, last: false });
    expect(b.size).toBe(1);
  });

  it('is bounded: the oldest key is evicted once maxKeys is reached', () => {
    const b = new RetryBudget(5, 3);
    ['a', 'b', 'c', 'd'].forEach((k) => b.next(k));
    expect(b.size).toBe(3);
    expect(b.next('a').attempt).toBe(1); // evicted, starts over
  });
});

describe('redactSeedRequest', () => {
  it('replaces only the attestation token and leaves the rest of the payload intact', () => {
    const payload = { requestId: 'r1', attestation: { kind: 'service-token', token: TOKEN }, lists: [1] };
    const out = redactSeedRequest(payload) as typeof payload;
    expect(out.attestation).toEqual({ kind: 'service-token', token: '[REDACTED]' });
    expect(out.requestId).toBe('r1');
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(payload.attestation.token).toBe(TOKEN); // the input is not mutated
  });

  it('passes through anything that is not an object with an attestation object', () => {
    expect(redactSeedRequest(null)).toBeNull();
    expect(redactSeedRequest('x')).toBe('x');
    expect(redactSeedRequest({ a: 1 })).toEqual({ a: 1 });
  });
});
