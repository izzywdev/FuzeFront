import type {
  CustomHostname,
  RecordPurpose,
  VerificationRecord,
} from './types';

/**
 * Status helpers shared by the backend reconcile path and the UI.
 *
 * Two rules from FuzeInfra's contract are enforced here so no caller has to
 * remember them:
 *
 *  1. **`active` is the only field to gate on** before advertising a domain to
 *     a user. It is true only when DNS, TLS, and in-cluster routing all agree;
 *     any one missing means the customer would hit an error page.
 *  2. **`provider.*` is a debugging passthrough outside the frozen contract.**
 *     Nothing here reads it, and nothing downstream should.
 */

/**
 * The single question the UI must ask before showing a domain as usable.
 *
 * Deliberately not `tls_status === 'active'` — a certificate can be live while
 * the routing Ingress is missing, which serves a valid cert in front of a
 * Traefik 404. That is the worst failure mode to debug, so we gate on the
 * boolean FuzeInfra computes across all three signals.
 */
export function isAdvertisable(hostname: CustomHostname): boolean {
  return hostname.active === true;
}

/**
 * True when polling should stop.
 *
 * `failed` and `expired` are terminal until the customer fixes their DNS —
 * re-POSTing is the retry. `blocked` means Cloudflare refused the hostname
 * because another account claimed it, which no amount of waiting resolves.
 *
 * `moved` is deliberately NOT terminal: it means an already-working domain
 * stopped pointing at us, which is recoverable the moment DNS is restored.
 * Unknown upstream states map to `pending` by contract, so they keep polling
 * rather than dead-ending — a vocabulary change at Cloudflare must never
 * present as a failure.
 */
export function isTerminal(hostname: CustomHostname): boolean {
  if (hostname.active === true) return true;
  if (hostname.tls_status === 'failed' || hostname.tls_status === 'expired') return true;
  if (hostname.dns_status === 'blocked') return true;
  return false;
}

/** A terminal state that is NOT success — the UI must show `error` + a retry. */
export function isTerminalFailure(hostname: CustomHostname): boolean {
  return isTerminal(hostname) && !isAdvertisable(hostname);
}

/**
 * FuzeInfra's documented polling schedule: every 10s for the first 2 minutes,
 * then every 60s. Each poll is a Cloudflare API call upstream, so this is a
 * rate limit we are asked to respect, not a tuning knob.
 */
export const FAST_POLL_INTERVAL_MS = 10_000;
export const SLOW_POLL_INTERVAL_MS = 60_000;
export const FAST_POLL_WINDOW_MS = 120_000;

/** Interval to wait before the next poll, given how long we have been polling. */
export function nextPollDelayMs(elapsedMs: number): number {
  return elapsedMs < FAST_POLL_WINDOW_MS ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
}

/**
 * Infer a record's purpose when the upstream omits it.
 *
 * `purpose` is optional in the frozen schema (`required: [method, record,
 * value]`) but the UI must render all three records labelled by purpose. Rather
 * than dropping an unlabelled record — which would silently hide a record the
 * customer needs to publish — we infer from the well-known record names.
 */
export function recordPurpose(record: VerificationRecord): RecordPurpose {
  if (record.purpose) return record.purpose;
  if (record.method === 'cname') return 'routing';
  if (record.record.startsWith('_acme-challenge.')) return 'certificate';
  return 'ownership';
}

/**
 * Every record the customer must publish, in the order the UI should show them:
 * ownership, then certificate, then routing. Routing goes last deliberately —
 * a customer migrating a live domain publishes the two TXT records first,
 * watches TLS go active, and only then cuts the CNAME over. That ordering is
 * what makes a zero-downtime migration possible, so the UI should not invite
 * them to flip DNS first.
 */
const PURPOSE_ORDER: readonly RecordPurpose[] = ['ownership', 'certificate', 'routing'];

export function orderedVerificationRecords(
  hostname: CustomHostname
): VerificationRecord[] {
  const records = hostname.verification?.records ?? [];
  return [...records].sort(
    (a, b) => PURPOSE_ORDER.indexOf(recordPurpose(a)) - PURPOSE_ORDER.indexOf(recordPurpose(b))
  );
}
