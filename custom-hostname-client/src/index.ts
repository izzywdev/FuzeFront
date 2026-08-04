/**
 * @fuzeone/custom-hostname-client
 *
 * Typed client for FuzeInfra's cluster-internal Custom Hostname API — the
 * Cloudflare-for-SaaS-backed provisioning of customer-owned domains
 * (`app.corpabc.com`) onto the shared cluster.
 *
 * The types are GENERATED from the frozen contract at
 * `services/custom-hostname-api/openapi.yaml` (a commit-pinned vendored copy of
 * FuzeInfra's file — see that directory's README). Do not hand-edit `schema.ts`.
 *
 * FuzeFront never holds a Cloudflare credential. The only secret involved is the
 * FuzeInfra-issued bearer token in `CUSTOM_HOSTNAME_API_TOKEN`.
 */
export { CustomHostnameClient, DEFAULT_BASE_URL } from './client';
export { CustomHostnameApiError } from './errors';

export {
  isAdvertisable,
  isTerminal,
  isTerminalFailure,
  nextPollDelayMs,
  recordPurpose,
  orderedVerificationRecords,
  FAST_POLL_INTERVAL_MS,
  SLOW_POLL_INTERVAL_MS,
  FAST_POLL_WINDOW_MS,
} from './status';

export {
  DOMAIN_OPTIONS,
  DEFAULT_DOMAIN_OPTION,
  A_RECORDS_SUPPORTED,
  looksLikeApex,
  cnameTarget,
} from './apex';
export type { ApexSupport, DomainOption } from './apex';

export type {
  Certificate,
  CreateCustomHostnameRequest,
  CustomHostname,
  CustomHostnameClientConfig,
  CustomHostnameList,
  DnsStatus,
  Domain,
  ErrorBody,
  ErrorCode,
  Health,
  ListCustomHostnamesParams,
  Provider,
  RecordPurpose,
  Routing,
  TlsStatus,
  Verification,
  VerificationRecord,
} from './types';

export type { components, operations, paths } from './schema';
