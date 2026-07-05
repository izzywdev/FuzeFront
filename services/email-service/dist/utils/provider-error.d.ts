/**
 * Stable error codes that are safe to emit on the status Kafka topic and to
 * structured logs.  Raw provider messages must NOT leave this module.
 */
export type ProviderErrorCode = 'provider_timeout' | 'provider_4xx' | 'provider_5xx' | 'invalid_recipient' | 'unknown';
/**
 * Classify a raw provider error message into a stable, non-PII error code.
 */
export declare function classifyProviderError(rawMessage: string): ProviderErrorCode;
//# sourceMappingURL=provider-error.d.ts.map