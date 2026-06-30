import { createAuthnValidator, FamilyTokenError } from './validator'
import type { AuthnConfig, FamilyPrincipal } from './types'

/**
 * Minimal structural shapes for an Express-style request/response so this
 * package does not need to depend on `@types/express` (which the monorepo pins
 * carefully). Any Express handler satisfies these.
 */
interface MinimalRequest {
  headers: Record<string, string | string[] | undefined>
  familyPrincipal?: FamilyPrincipal
}
interface MinimalResponse {
  status(code: number): MinimalResponse
  json(body: unknown): unknown
}
type MinimalNext = (err?: unknown) => void

function extractBearer(req: MinimalRequest): string | undefined {
  const header = req.headers['authorization'] ?? req.headers['Authorization']
  const value = Array.isArray(header) ? header[0] : header
  if (!value || !/^Bearer\s+/i.test(value)) return undefined
  return value.replace(/^Bearer\s+/i, '').trim() || undefined
}

/**
 * Express middleware enforcing the Fuze family AuthN contract. On success it
 * attaches the validated principal to `req.familyPrincipal` and calls `next()`.
 * On failure it responds `401` with a stable error code — it never throws into
 * the framework's error path.
 *
 * @example
 *   app.use(requireFamilyAuth({
 *     issuer: process.env.FUZE_AUTHN_ISSUER!,
 *     audience: process.env.FUZE_AUTHN_AUDIENCE!,
 *     jwksUri: process.env.FUZE_AUTHN_JWKS_URI!,
 *   }))
 */
export function requireFamilyAuth(config: AuthnConfig) {
  const validator = createAuthnValidator(config)

  return async function familyAuthMiddleware(
    req: MinimalRequest,
    res: MinimalResponse,
    next: MinimalNext
  ): Promise<void> {
    const token = extractBearer(req)
    if (!token) {
      res.status(401).json({ error: 'missing_bearer_token' })
      return
    }
    try {
      req.familyPrincipal = await validator.validate(token)
      next()
    } catch (err) {
      const code = err instanceof FamilyTokenError ? err.code : 'invalid_token'
      res.status(401).json({ error: code, message: (err as Error).message })
    }
  }
}
