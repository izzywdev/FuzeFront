/**
 * spec.ts — loads the FROZEN OpenAPI contract (packages/security/openapi.yaml)
 * and exposes an Ajv-based response/request schema validator.
 *
 * This is the source of truth for the INDEPENDENT AuthN verification suite.
 * Tests assert the contract, never the implementation's internals.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import Ajv2020, { ValidateFunction } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'

export const SPEC_PATH = path.resolve(
  __dirname,
  '../../../../packages/security/openapi.yaml'
)

export const spec: any = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'))

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  // Contract is same-origin JSON; discriminated oneOf handled structurally.
})
addFormats(ajv)
ajv.addSchema(spec, 'spec')

const compiledCache = new Map<string, ValidateFunction>()

/** Compile (and cache) a validator for a named component schema. */
export function validatorFor(schemaName: string): ValidateFunction {
  const key = `spec#/components/schemas/${schemaName}`
  let v = compiledCache.get(key)
  if (!v) {
    v = ajv.compile({ $ref: key })
    compiledCache.set(key, v)
  }
  return v
}

/**
 * Assert `data` conforms to component schema `schemaName`.
 * Throws a readable error (with Ajv errors) on failure — a failing contract
 * assertion is a valid, reportable deliverable.
 */
export function assertSchema(schemaName: string, data: unknown): void {
  const validate = validatorFor(schemaName)
  const ok = validate(data)
  if (!ok) {
    throw new Error(
      `Response does not conform to schema "${schemaName}":\n` +
        JSON.stringify(validate.errors, null, 2) +
        `\n--- payload ---\n` +
        JSON.stringify(data, null, 2)
    )
  }
}

/** Convenience matcher wrapper for Jest expect(). */
export function conformsTo(schemaName: string, data: unknown): boolean {
  const validate = validatorFor(schemaName)
  return validate(data) === true
}

/** The two hosts a browser may EVER transit for AuthN (boundary guarantee). */
export const FUZEFRONT_OWNED_HOST = 'app.fuzefront.com'
export const ALLOWED_SOCIAL_HOSTS = new Set([
  FUZEFRONT_OWNED_HOST,
  'accounts.google.com', // Google's own consent host — the one unavoidable hop
])

/** Hosts / vendor names that must NEVER appear in any AuthN response. */
export const FORBIDDEN_INTERNAL_HOST = 'auth.fuzefront.com'
export const FORBIDDEN_VENDOR_TOKENS = ['authentik', 'permit', 'permitio', 'okta', 'auth0']

/**
 * Every path in the spec + whether it is pagination-exempt, extracted straight
 * from the frozen contract so the pagination gate can't drift from it.
 */
export interface EndpointFlag {
  path: string
  method: string
  operationId?: string
  paginated: boolean
  exempt: boolean
  exemptReason?: string
}

export function listEndpoints(): EndpointFlag[] {
  const out: EndpointFlag[] = []
  for (const [p, ops] of Object.entries<any>(spec.paths)) {
    for (const [method, op] of Object.entries<any>(ops)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue
      const exempt = op['x-pagination'] === 'exempt'
      // A paginated endpoint declares Limit + Cursor params (family standard).
      const params = (op.parameters || []).map((x: any) => x.$ref || '')
      const hasLimit = params.some((r: string) => r.endsWith('/Limit'))
      const hasCursor = params.some((r: string) => r.endsWith('/Cursor'))
      out.push({
        path: p,
        method,
        operationId: op.operationId,
        paginated: hasLimit && hasCursor && !exempt,
        exempt,
        exemptReason: op['x-pagination-reason'],
      })
    }
  }
  return out
}
