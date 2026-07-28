/**
 * Unit tests for the status/gating policy. These run offline; the behavioural
 * contract itself is verified against the real stub in stub.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  A_RECORDS_SUPPORTED,
  DEFAULT_DOMAIN_OPTION,
  DOMAIN_OPTIONS,
  looksLikeApex,
} from '../src/apex';
import { CustomHostnameApiError } from '../src/errors';
import {
  FAST_POLL_INTERVAL_MS,
  SLOW_POLL_INTERVAL_MS,
  isAdvertisable,
  isTerminal,
  isTerminalFailure,
  nextPollDelayMs,
  recordPurpose,
} from '../src/status';
import type { CustomHostname, DnsStatus, TlsStatus } from '../src/types';

function hostname(
  over: Partial<CustomHostname> & { dns_status?: DnsStatus; tls_status?: TlsStatus } = {}
): CustomHostname {
  return {
    domain: 'app.corpabc.com',
    profile: 'fuzefront',
    active: false,
    dns_status: 'pending',
    tls_status: 'pending_validation',
    verification: {
      method: 'txt',
      record: '_cf-custom-hostname.app.corpabc.com',
      value: 'token',
      records: [],
    },
    created_at: '2026-07-28T10:00:00Z',
    ...over,
  } as CustomHostname;
}

describe('isAdvertisable', () => {
  it('gates ONLY on `active`, never on tls_status alone', () => {
    // The failure mode this prevents: a valid certificate in front of a
    // Traefik 404 because the routing Ingress is missing.
    const certLiveButNotRouted = hostname({
      tls_status: 'active',
      dns_status: 'active',
      active: false,
    });
    expect(certLiveButNotRouted.tls_status).toBe('active');
    expect(isAdvertisable(certLiveButNotRouted)).toBe(false);
  });

  it('is true only when the API says active', () => {
    expect(isAdvertisable(hostname({ active: true }))).toBe(true);
    expect(isAdvertisable(hostname({ active: false }))).toBe(false);
  });
});

describe('isTerminal', () => {
  it.each(['pending_validation', 'pending_issuance', 'pending_deployment'] as const)(
    'keeps polling while tls_status is %s',
    (tls) => {
      expect(isTerminal(hostname({ tls_status: tls }))).toBe(false);
    }
  );

  it.each(['failed', 'expired'] as const)('stops on terminal tls_status %s', (tls) => {
    const h = hostname({ tls_status: tls, error: 'validation failed' });
    expect(isTerminal(h)).toBe(true);
    expect(isTerminalFailure(h)).toBe(true);
  });

  it('stops on dns_status blocked — another account claimed the hostname', () => {
    expect(isTerminal(hostname({ dns_status: 'blocked' }))).toBe(true);
  });

  it('keeps polling on dns_status moved — that is recoverable', () => {
    expect(isTerminal(hostname({ dns_status: 'moved' }))).toBe(false);
  });

  it('stops once active', () => {
    const h = hostname({ active: true, dns_status: 'active', tls_status: 'active' });
    expect(isTerminal(h)).toBe(true);
    expect(isTerminalFailure(h)).toBe(false);
  });
});

describe('nextPollDelayMs', () => {
  it('polls every 10s for the first 2 minutes, then every 60s', () => {
    // A rate limit FuzeInfra asked us to respect: each GET is a Cloudflare
    // API call. These are not tuning knobs.
    expect(nextPollDelayMs(0)).toBe(FAST_POLL_INTERVAL_MS);
    expect(nextPollDelayMs(119_999)).toBe(FAST_POLL_INTERVAL_MS);
    expect(nextPollDelayMs(120_000)).toBe(SLOW_POLL_INTERVAL_MS);
    expect(nextPollDelayMs(600_000)).toBe(SLOW_POLL_INTERVAL_MS);
  });

  it('never polls faster than 10s', () => {
    for (let t = 0; t < 600_000; t += 7_777) {
      expect(nextPollDelayMs(t)).toBeGreaterThanOrEqual(FAST_POLL_INTERVAL_MS);
    }
  });
});

describe('recordPurpose', () => {
  it('uses the declared purpose when present', () => {
    expect(
      recordPurpose({ method: 'txt', record: 'x', value: 'y', purpose: 'certificate' })
    ).toBe('certificate');
  });

  it('infers a missing purpose rather than dropping the record', () => {
    // `purpose` is optional in the frozen schema, but a record the customer
    // must publish can never be silently hidden.
    expect(recordPurpose({ method: 'cname', record: 'app.corpabc.com', value: 'c' })).toBe(
      'routing'
    );
    expect(
      recordPurpose({ method: 'txt', record: '_acme-challenge.app.corpabc.com', value: 'v' })
    ).toBe('certificate');
    expect(
      recordPurpose({ method: 'txt', record: '_cf-custom-hostname.app.corpabc.com', value: 'v' })
    ).toBe('ownership');
  });
});

describe('apex guidance', () => {
  it('leads with a subdomain CNAME', () => {
    expect(DEFAULT_DOMAIN_OPTION.id).toBe('subdomain');
    expect(DEFAULT_DOMAIN_OPTION.recordType).toBe('CNAME');
    expect(DEFAULT_DOMAIN_OPTION.support).toBe('preferred');
  });

  it('NEVER offers A records — CF for SaaS gives a CNAME target, not stable IPs', () => {
    expect(A_RECORDS_SUPPORTED).toBe(false);
    expect(DOMAIN_OPTIONS.some((o) => o.recordType === 'A')).toBe(false);
  });

  it('is ordered by preference', () => {
    expect(DOMAIN_OPTIONS.map((o) => o.rank)).toEqual([1, 2, 3]);
  });

  it('detects apex domains', () => {
    expect(looksLikeApex('corpabc.com')).toBe(true);
    expect(looksLikeApex('app.corpabc.com')).toBe(false);
  });
});

describe('CustomHostnameApiError', () => {
  it('derives the code from the body', () => {
    const err = CustomHostnameApiError.fromResponse(422, {
      error: 'validation_error',
      message: 'inside managed zone',
    });
    expect(err.code).toBe('validation_error');
    expect(err.isValidationError).toBe(true);
  });

  it('falls back to the status when the body is unparseable', () => {
    // e.g. an HTML 502 from a proxy. `code` must still be meaningful so
    // callers never have to string-match a message.
    expect(CustomHostnameApiError.fromResponse(502, '<html>bad gateway</html>').code).toBe(
      'upstream_error'
    );
    expect(CustomHostnameApiError.fromResponse(401, null).code).toBe('unauthorized');
  });

  it('types 429 quota_exceeded as a real error, not a retry', () => {
    // Not declared as a response on POST in the frozen spec — filed upstream.
    // Handled by status code regardless.
    const err = CustomHostnameApiError.fromResponse(429, {
      error: 'quota_exceeded',
      message: 'cap reached',
    });
    expect(err.isQuotaExceeded).toBe(true);
    expect(err.isUpstreamError).toBe(false);
  });
});
