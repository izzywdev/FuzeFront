/**
 * Shared structured logger for the security-service.
 *
 * Auth-critical code (password login, OIDC brokering, broker codes, API
 * tokens, org provisioning, authz) previously logged via raw `console.*` with
 * no level control and no redaction — a credential or auth code could end up
 * in plaintext logs, and there was no way to turn on per-hop DEBUG detail in
 * prod without a redeploy. This wraps `pino`:
 *   - level from `LOG_LEVEL` (default `info`); set `LOG_LEVEL=debug` to get
 *     per-hop detail without a rebuild.
 *   - JSON output, ISO timestamps.
 *   - mandatory redaction of common credential/secret shapes.
 *
 * Use `logger.child({ reqId })` (see `withReqId`) to correlate every log line
 * within a request with the `[security-service:xxxx]` id already assigned by
 * `@fuzefront/core`'s `createExpressApp` (req.requestId).
 */
import pino from 'pino'

const REDACT_PATHS = [
  'password',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'code',
  'client_secret',
  'clientSecret',
  'codeVerifier',
  'code_verifier',
  'authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.cookie',
  'headers.Cookie',
  'cookie',
  'Cookie',
  // `set-cookie` contains a hyphen, so it is NOT a valid fast-redact
  // dot-path identifier — a bare `set-cookie` entry makes pino throw
  // "redact paths array contains an invalid path (set-cookie)" at logger
  // construction, crashing the service on boot. Hyphenated keys must use
  // bracket notation. Set-Cookie is a response header, so target it there
  // (plus a top-level bracketed form for any raw header dump).
  'res.headers["set-cookie"]',
  '["set-cookie"]',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.id_token',
  '*.code',
  '*.client_secret',
  '*.clientSecret',
  '*.codeVerifier',
  '*.code_verifier',
  '*.authorization',
  '*.cookie',
]

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  base: { service: 'security-service' },
})

/** Bind a per-request child logger to the `[security-service:xxxx]` request id. */
export function withReqId(reqId?: string) {
  return logger.child({ reqId: reqId || 'unknown' })
}

export default logger
