import { dirname, extname, isAbsolute, join, normalize as normalizePath, relative, resolve, sep } from 'node:path'
import { readFile } from 'node:fs/promises'
import YAML from 'yaml'
import type { ApiOperation, Repository, ScanDiagnostic } from '@fuzequality/contracts'

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'])
const digestPath = (value: string) =>
  value.split(sep).join('/').replace(/\/+/g, '/').replace(/\/$/, '')
const normalizedRoute = (value: string) =>
  `/${value}`.replace(/\/+/g, '/').replace(/\{[^}]+\}/g, '{}').replace(/\/$/, '') || '/'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function within(root: string, candidate: string) {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

async function validateRefs(
  root: string,
  documentPath: string,
  value: unknown,
  diagnostics: ScanDiagnostic[],
  visited = new Set<string>()
): Promise<void> {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) await validateRefs(root, documentPath, item, diagnostics, visited)
    return
  }
  const record = value as Record<string, unknown>
  if (typeof record.$ref === 'string' && !record.$ref.startsWith('#')) {
    const [referencePath] = record.$ref.split('#')
    const target = resolve(root, dirname(documentPath), referencePath)
    if (!within(root, target)) {
      diagnostics.push({
        sourcePath: digestPath(documentPath),
        category: 'openapi',
        severity: 'error',
        code: 'openapi-ref-outside-repository',
        message: `Refusing OpenAPI reference outside repository: ${record.$ref}`,
      })
    } else if (!visited.has(target)) {
      visited.add(target)
      try {
        const source = await readFile(target, 'utf8')
        const parsed = extname(target).toLowerCase() === '.json' ? JSON.parse(source) : YAML.parse(source)
        await validateRefs(root, digestPath(relative(root, target)), parsed, diagnostics, visited)
      } catch (error) {
        diagnostics.push({
          sourcePath: digestPath(documentPath),
          category: 'openapi',
          severity: 'error',
          code: 'unresolved-openapi-ref',
          message: `Cannot resolve ${record.$ref}: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
  }
  for (const child of Object.values(record)) {
    await validateRefs(root, documentPath, child, diagnostics, visited)
  }
}

function parameters(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const parameter = asRecord(item)
    if (!parameter || '$ref' in parameter) return []
    return [{
      name: String(parameter.name ?? 'unnamed'),
      location: String(parameter.in ?? 'unknown'),
      required: Boolean(parameter.required),
      schema: asRecord(parameter.schema),
    }]
  })
}

function contentTypes(value: unknown) {
  return Object.keys(asRecord(asRecord(value)?.content) ?? {})
}

function securityNames(document: Record<string, unknown>, operation: Record<string, unknown>) {
  const security = 'security' in operation ? operation.security : document.security
  if (!Array.isArray(security)) return []
  return [...new Set(security.flatMap(item => Object.keys(asRecord(item) ?? {})))]
}

export async function parseOpenApiDocument(
  root: string,
  repository: Repository,
  file: string,
  content: string
): Promise<{ operations: ApiOperation[]; diagnostics: ScanDiagnostic[] }> {
  const diagnostics: ScanDiagnostic[] = []
  const parsed = extname(file).toLowerCase() === '.json' ? JSON.parse(content) : YAML.parse(content)
  const document = asRecord(parsed)
  if (!document) throw new Error('OpenAPI document must be an object')
  const version = typeof document.openapi === 'string'
    ? document.openapi
    : typeof document.swagger === 'string' ? document.swagger : undefined
  if (!version || !(version === '2.0' || /^3\.(?:0|1)\.\d+(?:[-+].*)?$/.test(version))) {
    throw new Error(`Unsupported or missing OpenAPI version: ${version ?? 'none'}`)
  }
  const paths = asRecord(document.paths)
  if (!paths) throw new Error('OpenAPI document has no paths object')
  await validateRefs(root, file, document, diagnostics)

  const operations: ApiOperation[] = []
  for (const [route, rawPathItem] of Object.entries(paths)) {
    const pathItem = asRecord(rawPathItem)
    if (!pathItem) continue
    for (const [rawMethod, rawOperation] of Object.entries(pathItem)) {
      const method = rawMethod.toLowerCase()
      const operation = asRecord(rawOperation)
      if (!METHODS.has(method) || !operation) continue
      const operationId = typeof operation.operationId === 'string' && operation.operationId.trim()
        ? operation.operationId.trim()
        : undefined
      const stablePart = operationId ?? `${method.toUpperCase()}:${normalizedRoute(route)}`
      const responses = asRecord(operation.responses) ?? {}
      const securitySchemes = securityNames(document, operation)
      const allParameters = [...parameters(pathItem.parameters), ...parameters(operation.parameters)]
      const idempotency = allParameters.find(item =>
        item.location === 'header' && /idempotency/i.test(item.name)
      )
      operations.push({
        id: `api:${repository.name}:${digestPath(file)}:${stablePart}`,
        repositoryId: repository.id,
        documentPath: digestPath(file),
        operationId,
        method,
        path: route,
        summary: String(operation.summary ?? operation.description ?? stablePart),
        tags: Array.isArray(operation.tags) ? operation.tags.map(String) : [],
        security: securitySchemes.length > 0,
        securitySchemes,
        parameters: allParameters,
        responses: Object.keys(responses),
        requestContentTypes: version === '2.0'
          ? (Array.isArray(operation.consumes ?? document.consumes) ? ((operation.consumes ?? document.consumes) as unknown[]).map(String) : [])
          : contentTypes(operation.requestBody),
        responseContentTypes: version === '2.0'
          ? (Array.isArray(operation.produces ?? document.produces) ? ((operation.produces ?? document.produces) as unknown[]).map(String) : [])
          : [...new Set(Object.values(responses).flatMap(response => contentTypes(response)))],
        idempotencyHeader: idempotency?.name,
        supportsCrudSequence: /\/\{[^}]+\}$/.test(route) && ['get', 'put', 'patch', 'delete'].includes(method),
      })
    }
  }
  return { operations, diagnostics }
}

export function referencedOpenApiPaths(source: string) {
  return [...new Set(
    [...source.matchAll(/['"`]([^'"`\r\n]+\.(?:ya?ml|json))['"`]/gi)]
      .map(match => normalizePath(match[1]).split(sep).join('/'))
      .filter(path => !path.includes('://') && !path.startsWith('/'))
  )]
}
