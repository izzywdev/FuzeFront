/**
 * Render a Permit SDK error for logging WITHOUT leaking the Permit API key.
 *
 * The permitio SDK talks to the PDP / Permit cloud API over axios, constructed
 * with `token: process.env.PERMIT_API_KEY` (see backend/src/config/permit.ts).
 * An AxiosError carries `config` as an OWN ENUMERABLE property, and
 * `console.error(msg, err)` renders via `util.inspect` — NOT `AxiosError.toJSON`
 * — whose default depth of 2 is exactly deep enough to reach
 * `config.headers.Authorization`, i.e. `Bearer <PERMIT_API_KEY>`.
 *
 * So `console.error('...', error)` on a rethrown SDK error prints the API key to
 * stdout, therefore to Loki and to log backups. This is the same defect already
 * documented and defended against in backend/scripts/permit-complete-setup.js.
 *
 * This helper reads ONLY non-secret fields and never touches `error.config`.
 * Returns a JSON string, so `%s`-formatting it also escapes newlines and cannot
 * forge a log entry.
 */
export function describePermitError(error: unknown): string {
  const e = error as {
    code?: unknown
    message?: unknown
    response?: { status?: unknown; statusText?: unknown }
  }
  return JSON.stringify({
    code: e?.code ?? null,
    status: e?.response?.status ?? null,
    statusText: e?.response?.statusText ?? null,
    message: error instanceof Error ? error.message : String(error),
  })
}
