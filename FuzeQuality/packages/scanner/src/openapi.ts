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

function decodePointerToken(value: string) {
  return decodeURIComponent(value).replace(/~1/g, '/').replace(/~0/g, '~')
}

function resolvePointer(document: unknown, fragment: string) {
  if (!fragment || fragment === '#') return document
  if (!fragment.startsWith('#/')) throw new Error(`Unsupported OpenAPI reference fragment: ${fragment}`)
  return fragment.slice(2).split('/').reduce<unknown>((value, token) => {
    const record = asRecord(value)
    const key = decodePointerToken(token)
    if (!record || !(key in record)) throw new Error(`OpenAPI reference fragment does not exist: ${fragment}`)
    return record[key]
  }, document)
}

class RepositoryReferenceResolver {
  private readonly documents = new Map<string, unknown>()

  constructor(
    private readonly root: string,
    rootFile: string,
    rootDocument: unknown,
    private readonly diagnostics: ScanDiagnostic[]
  ) {
    this.documents.set(resolve(root, rootFile), rootDocument)
  }

  private async document(path: string) {
    const cached = this.documents.get(path)
    if (cached !== undefined) return cached
    const source = await readFile(path, 'utf8')
    const parsed = extname(path).toLowerCase() === '.json' ? JSON.parse(source) : YAML.parse(source)
    this.documents.set(path, parsed)
    return parsed
  }

  async record(
    value: unknown,
    currentFile: string,
    chain = new Set<string>()
  ): Promise<{ value?: Record<string, unknown>; sourcePath: string }> {
    const record = asRecord(value)
    if (!record) return { sourcePath: digestPath(currentFile) }
    if (typeof record.$ref !== 'string') {
      return { value: record, sourcePath: digestPath(currentFile) }
    }

    const reference = record.$ref
    const [referencePath, rawFragment = ''] = reference.split('#', 2)
    if (!referencePath) {
      try {
        return {
          value: asRecord(resolvePointer(this.documents.get(resolve(this.root, currentFile)), `#${rawFragment}`)),
          sourcePath: digestPath(currentFile),
        }
      } catch (error) {
        this.diagnostic(currentFile, 'unresolved-openapi-ref', reference, error)
        return { sourcePath: digestPath(currentFile) }
      }
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(referencePath) || isAbsolute(referencePath)) {
      this.diagnostics.push({
        sourcePath: digestPath(currentFile),
        category: 'openapi',
        severity: 'error',
        code: 'openapi-ref-outside-repository',
        message: `Refusing non-repository OpenAPI reference: ${reference}`,
      })
      return { sourcePath: digestPath(currentFile) }
    }

    const target = resolve(this.root, dirname(currentFile), referencePath)
    if (!within(this.root, target)) {
      this.diagnostics.push({
        sourcePath: digestPath(currentFile),
        category: 'openapi',
        severity: 'error',
        code: 'openapi-ref-outside-repository',
        message: `Refusing OpenAPI reference outside repository: ${reference}`,
      })
      return { sourcePath: digestPath(currentFile) }
    }

    const identity = `${target}#${rawFragment}`
    if (chain.has(identity)) {
      this.diagnostics.push({
        sourcePath: digestPath(currentFile),
        category: 'openapi',
        severity: 'error',
        code: 'cyclic-openapi-ref',
        message: `Cyclic OpenAPI reference cannot define a catalog entity: ${reference}`,
      })
      return { sourcePath: digestPath(relative(this.root, target)) }
    }

    try {
      const document = await this.document(target)
      const referenced = resolvePointer(document, rawFragment ? `#${rawFragment}` : '')
      const next = new Set(chain)
      next.add(identity)
      const resolved = await this.record(referenced, digestPath(relative(this.root, target)), next)
      return {
        value: resolved.value ? { ...resolved.value, ...Object.fromEntries(Object.entries(record).filter(([key]) => key !== '$ref')) } : undefined,
        sourcePath: resolved.sourcePath,
      }
    } catch (error) {
      this.diagnostic(currentFile, 'unresolved-openapi-ref', reference, error)
      return { sourcePath: digestPath(relative(this.root, target)) }
    }
  }

  private diagnostic(currentFile: string, code: string, reference: string, error: unknown) {
    this.diagnostics.push({
      sourcePath: digestPath(currentFile),
      category: 'openapi',
      severity: 'error',
      code,
      message: `Cannot resolve ${reference}: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
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
    if (/^[a-z][a-z0-9+.-]*:/i.test(referencePath) || isAbsolute(referencePath)) {
      diagnostics.push({
        sourcePath: digestPath(documentPath),
        category: 'openapi',
        severity: 'error',
        code: 'openapi-ref-outside-repository',
        message: `Refusing non-repository OpenAPI reference: ${record.$ref}`,
      })
      return
    }
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

async function parameters(
  value: unknown,
  resolver: RepositoryReferenceResolver,
  currentFile: string,
  sourcePaths: Set<string>
) {
  if (!Array.isArray(value)) return []
  const result: ApiOperation['parameters'] = []
  for (const item of value) {
    const resolved = await resolver.record(item, currentFile)
    if (!resolved.value) continue
    sourcePaths.add(resolved.sourcePath)
    result.push({
      name: String(resolved.value.name ?? 'unnamed'),
      location: String(resolved.value.in ?? 'unknown'),
      required: Boolean(resolved.value.required),
      schema: asRecord(resolved.value.schema),
    })
  }
  return result
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
  const resolver = new RepositoryReferenceResolver(root, file, document, diagnostics)
  const info = asRecord(document.info)
  const documentTitle = typeof info?.title === 'string' ? info.title : undefined
  const documentVersion = typeof info?.version === 'string' ? info.version : undefined
  const documentServers = Array.isArray(document.servers)
    ? document.servers.flatMap(server => typeof asRecord(server)?.url === 'string' ? [String(asRecord(server)?.url)] : [])
    : []

  const operations: ApiOperation[] = []
  for (const [route, rawPathItem] of Object.entries(paths)) {
    const resolvedPathItem = await resolver.record(rawPathItem, file)
    const pathItem = resolvedPathItem.value
    if (!pathItem) continue
    for (const [rawMethod, rawOperation] of Object.entries(pathItem)) {
      const method = rawMethod.toLowerCase()
      const resolvedOperation = await resolver.record(rawOperation, resolvedPathItem.sourcePath)
      const operation = resolvedOperation.value
      if (!METHODS.has(method) || !operation) continue
      const sourcePaths = new Set([digestPath(file), resolvedPathItem.sourcePath, resolvedOperation.sourcePath])
      const operationId = typeof operation.operationId === 'string' && operation.operationId.trim()
        ? operation.operationId.trim()
        : undefined
      const stablePart = operationId ?? `${method.toUpperCase()}:${normalizedRoute(route)}`
      const responses = asRecord(operation.responses) ?? {}
      const securitySchemes = securityNames(document, operation)
      const allParameters = [
        ...await parameters(pathItem.parameters, resolver, resolvedPathItem.sourcePath, sourcePaths),
        ...await parameters(operation.parameters, resolver, resolvedOperation.sourcePath, sourcePaths),
      ]
      const resolvedRequestBody = await resolver.record(operation.requestBody, resolvedOperation.sourcePath)
      if (resolvedRequestBody.value) sourcePaths.add(resolvedRequestBody.sourcePath)
      const resolvedResponses: Record<string, Record<string, unknown>> = {}
      for (const [status, response] of Object.entries(responses)) {
        const resolvedResponse = await resolver.record(response, resolvedOperation.sourcePath)
        if (resolvedResponse.value) {
          resolvedResponses[status] = resolvedResponse.value
          sourcePaths.add(resolvedResponse.sourcePath)
        }
      }
      const idempotency = allParameters.find(item =>
        item.location === 'header' && /idempotency/i.test(item.name)
      )
      const operationServers = Array.isArray(operation.servers)
        ? operation.servers.flatMap(server => typeof asRecord(server)?.url === 'string' ? [String(asRecord(server)?.url)] : [])
        : documentServers
      operations.push({
        id: `api:${repository.name}:${digestPath(file)}:${stablePart}`,
        repositoryId: repository.id,
        documentPath: digestPath(file),
        specificationVersion: version,
        documentTitle,
        documentVersion,
        sourcePaths: [...sourcePaths].sort(),
        servers: operationServers,
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
          : contentTypes(resolvedRequestBody.value),
        requestBodyRequired: Boolean(resolvedRequestBody.value?.required),
        responseContentTypes: version === '2.0'
          ? (Array.isArray(operation.produces ?? document.produces) ? ((operation.produces ?? document.produces) as unknown[]).map(String) : [])
          : [...new Set(Object.values(resolvedResponses).flatMap(response => contentTypes(response)))],
        idempotencyHeader: idempotency?.name,
        supportsCrudSequence: /\/\{[^}]+\}$/.test(route) && ['get', 'put', 'patch', 'delete'].includes(method),
      })
    }
  }
  return {
    operations,
    diagnostics: [...new Map(
      diagnostics.map(diagnostic => [
        `${diagnostic.sourcePath}\u0000${diagnostic.code}\u0000${diagnostic.message}`,
        diagnostic,
      ])
    ).values()],
  }
}

export function referencedOpenApiPaths(source: string) {
  return [...new Set(
    [...source.matchAll(/['"`]([^'"`\r\n]+\.(?:ya?ml|json))['"`]/gi)]
      .map(match => normalizePath(match[1]).split(sep).join('/'))
      .filter(path => !path.includes('://') && !path.startsWith('/'))
  )]
}
