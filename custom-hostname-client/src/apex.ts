import type { Routing } from './types';

/**
 * Apex-domain guidance, published to customers in this order of preference.
 *
 * This is data rather than prose in a component so the backend, the UI, and the
 * docs cannot drift apart on what we tell a customer to do.
 *
 * The API rejects nothing based on apex-ness — an apex domain provisions fine.
 * The constraint is entirely the *customer's DNS provider*, which is why this
 * is guidance and not validation.
 */
export type ApexSupport = 'preferred' | 'supported' | 'advanced' | 'unsupported';

export interface DomainOption {
  readonly rank: number;
  readonly id: string;
  readonly support: ApexSupport;
  readonly title: string;
  readonly recordType: 'CNAME' | 'ALIAS/ANAME' | 'A';
  readonly summary: string;
  /** Providers known to support this. Empty when it works everywhere. */
  readonly knownProviders: readonly string[];
}

export const DOMAIN_OPTIONS: readonly DomainOption[] = [
  {
    rank: 1,
    id: 'subdomain',
    support: 'preferred',
    title: 'Subdomain (recommended)',
    recordType: 'CNAME',
    summary:
      'A plain CNAME from e.g. app.yourcompany.com to the platform edge. Works on every DNS provider, with no special record types.',
    knownProviders: [],
  },
  {
    rank: 2,
    id: 'apex-cloudflare',
    support: 'supported',
    title: 'Root domain, DNS hosted at Cloudflare',
    recordType: 'CNAME',
    summary:
      'A proxied CNAME at the root works via Cloudflare CNAME flattening. No caveats.',
    knownProviders: ['Cloudflare'],
  },
  {
    rank: 3,
    id: 'apex-alias',
    support: 'advanced',
    title: 'Root domain, DNS hosted elsewhere',
    recordType: 'ALIAS/ANAME',
    summary:
      'Needs an ALIAS or ANAME record. Many registrar-bundled DNS services cannot do this — if yours cannot, use a subdomain instead.',
    knownProviders: ['Route 53', 'DNSimple', 'DNS Made Easy', 'NS1', 'Azure DNS'],
  },
];

/**
 * Never offer A records. Cloudflare for SaaS gives a CNAME target, not stable
 * anycast IPs — hard-coded IPs will break without notice. Exported so the UI can
 * assert on it and a test can prove no A-record guidance was ever rendered.
 */
export const A_RECORDS_SUPPORTED = false as const;

/** The default the UI should suggest. */
export const DEFAULT_DOMAIN_OPTION = DOMAIN_OPTIONS[0];

/** Heuristic apex check, for choosing which guidance to lead with. */
export function looksLikeApex(domain: string): boolean {
  return domain.replace(/\.$/, '').split('.').length <= 2;
}

/**
 * The CNAME target to publish. Always sourced from the API response rather than
 * hard-coded: the target is a deliberate public contract, kept separate from
 * the origin so the origin can be repointed during a migration without asking
 * every customer to change their DNS.
 */
export function cnameTarget(routing: Routing | undefined): string | null {
  return routing?.cname_target ?? null;
}
