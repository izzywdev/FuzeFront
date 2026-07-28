import type { components } from './schema';

/**
 * Convenience aliases over the generated OpenAPI component schemas. The OpenAPI
 * document (`services/custom-hostname-api/openapi.yaml`, a pinned vendored copy
 * of FuzeInfra's frozen contract) is the source of truth; these names just make
 * the generated types ergonomic for consumers.
 */
export type Domain = components['schemas']['Domain'];
export type CustomHostname = components['schemas']['CustomHostname'];
export type CustomHostnameList = components['schemas']['CustomHostnameList'];
export type CreateCustomHostnameRequest =
  components['schemas']['CreateCustomHostnameRequest'];
export type Verification = components['schemas']['Verification'];
export type VerificationRecord = components['schemas']['VerificationRecord'];
export type DnsStatus = components['schemas']['DnsStatus'];
export type TlsStatus = components['schemas']['TlsStatus'];
export type Routing = components['schemas']['Routing'];
export type Certificate = components['schemas']['Certificate'];
export type Provider = components['schemas']['Provider'];
export type Health = components['schemas']['Health'];
export type ErrorBody = components['schemas']['Error'];

/** Stable machine-readable error codes. Branch on these, never on `message`. */
export type ErrorCode = ErrorBody['error'];

/** What a `VerificationRecord` proves. */
export type RecordPurpose = NonNullable<VerificationRecord['purpose']>;

export interface CustomHostnameClientConfig {
  /**
   * Base URL of the cluster-internal API. Defaults to the in-cluster service
   * DNS name; override for the kind stub or a local uvicorn run.
   */
  baseUrl?: string;
  /**
   * Bearer token from the `CUSTOM_HOSTNAME_API_TOKEN` SealedSecret. This is a
   * FuzeInfra-issued token identifying our route profile — it is NOT a
   * Cloudflare credential, and FuzeFront never holds one.
   */
  token: string;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /**
   * Route profile to attach domains to. Optional — our token grants exactly
   * one profile, which is the normal case. Naming a profile the token does not
   * grant is a 403, never a silent fallback.
   */
  profile?: string;
}

export interface ListCustomHostnamesParams {
  limit?: number;
  cursor?: string;
}
