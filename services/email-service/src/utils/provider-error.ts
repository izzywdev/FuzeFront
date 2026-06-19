/**
 * Stable error codes that are safe to emit on the status Kafka topic and to
 * structured logs.  Raw provider messages must NOT leave this module.
 */
export type ProviderErrorCode =
  | 'provider_timeout'
  | 'provider_4xx'
  | 'provider_5xx'
  | 'invalid_recipient'
  | 'unknown';

const TIMEOUT_PATTERNS = /timeout|timed.?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i;
const CLIENT_ERROR_PATTERNS = /\b4\d\d\b|bad.?request|unauthorized|forbidden|not.?found/i;
const SERVER_ERROR_PATTERNS = /\b5\d\d\b|internal.?server|service.?unavailable|bad.?gateway/i;
const RECIPIENT_PATTERNS = /invalid.?recipient|invalid.?email|no.?such.?user|user.?unknown|bounced/i;

/**
 * Classify a raw provider error message into a stable, non-PII error code.
 */
export function classifyProviderError(rawMessage: string): ProviderErrorCode {
  if (TIMEOUT_PATTERNS.test(rawMessage)) return 'provider_timeout';
  if (RECIPIENT_PATTERNS.test(rawMessage)) return 'invalid_recipient';
  if (SERVER_ERROR_PATTERNS.test(rawMessage)) return 'provider_5xx';
  if (CLIENT_ERROR_PATTERNS.test(rawMessage)) return 'provider_4xx';
  return 'unknown';
}
