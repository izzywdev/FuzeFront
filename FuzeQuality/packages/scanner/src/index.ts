import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import fg from 'fast-glob'
import YAML from 'yaml'
import type {
  ApiOperation,
  FrontendSurface,
  Repository,
  ScanDiagnostic,
  ScanResult,
  TestCase,
} from '@fuzequality/contracts'
import {
  buildApiExpectations,
  buildFindings,
  buildFrontendExpectations,
} from '@fuzequality/core'

const digest = (...parts: string[]) =>
  createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)

const fingerprint = (content: string) => createHash('sha256').update(content).digest('hex')

const normalize = (path: string) => path.split(sep).join('/')

const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/playwright-report*/**',
  '**/test-results*/**',
  '**/.terraform/**',
]

const OPENAPI_GLOBS = [
  '**/openapi.{yaml,yml,json}',
  '**/swagger.{yaml,yml,json}',
  '**/*openapi*.{yaml,yml,json}',
  '**/*swagger*.{yaml,yml,json}',
]

const TEST_GLOBS = [
  '**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,py}',
  '**/tests/**/*.{ts,tsx,js,jsx,mjs,cjs,py}',
  '**/e2e/**/*.{ts,tsx,js,jsx,mjs,cjs,py}',
]

function safeRoot(root: string) {
  return resolve(root)
}

async function readText(root: string, file: string) {
  const full = resolve(root, file)
  if (!full.startsWith(`${root}${sep}`) && full !== root) {
    throw new Error(`Refusing path outside repository: ${file}`)
  }
  const value = await readFile(full, 'utf8')
  if (value.length > 5_000_000) throw new Error(`File exceeds 5 MB scan limit: ${file}`)
  return value
}

function operationSecurity(document: Record<string, unknown>, value: Record<string, unknown>) {
  if ('security' in value) return Array.isArray(value.security) && value.security.length > 0
  return Array.isArray(document.security) && document.security.length > 0
}

function parseParameters(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter(item => item && typeof item === 'object' && !('$ref' in item))
    .map(item => {
      const parameter = item as Record<string, unknown>
      return {
        name: String(parameter.name ?? 'unnamed'),
        location: String(parameter.in ?? 'unknown'),
        required: Boolean(parameter.required),
        schema:
          parameter.schema && typeof parameter.schema === 'object'
            ? (parameter.schema as Record<string, unknown>)
            : undefined,
      }
    })
}

function parseOpenApi(
  repository: Repository,
  file: string,
  content: string
): ApiOperation[] {
  const parsed = file.endsWith('.json') ? JSON.parse(content) : YAML.parse(content)
  if (!parsed || typeof parsed !== 'object') return []
  const document = parsed as Record<string, unknown>
  const paths = document.paths
  if (!paths || typeof paths !== 'object') return []
  const operations: ApiOperation[] = []
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'])

  for (const [path, rawPath] of Object.entries(paths as Record<string, unknown>)) {
    if (!rawPath || typeof rawPath !== 'object') continue
    const pathItem = rawPath as Record<string, unknown>
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!methods.has(method.toLowerCase()) || !rawOperation || typeof rawOperation !== 'object') continue
      const operation = rawOperation as Record<string, unknown>
      const operationId = typeof operation.operationId === 'string' ? operation.operationId : undefined
      const stablePart = operationId ?? `${method.toUpperCase()}:${path}`
      operations.push({
        id: `api:${repository.name}:${digest(file)}:${stablePart}`,
        repositoryId: repository.id,
        documentPath: normalize(file),
        operationId,
        method: method.toLowerCase(),
        path,
        summary: String(operation.summary ?? operation.description ?? stablePart),
        tags: Array.isArray(operation.tags) ? operation.tags.map(String) : [],
        security: operationSecurity(document, operation),
        parameters: [
          ...parseParameters(pathItem.parameters),
          ...parseParameters(operation.parameters),
        ],
        responses:
          operation.responses && typeof operation.responses === 'object'
            ? Object.keys(operation.responses)
            : [],
      })
    }
  }
  return operations
}

function frameworkFor(file: string, source: string) {
  if (file.endsWith('.py')) return source.includes('schemathesis') ? 'schemathesis' : 'pytest'
  if (source.includes('@playwright/test')) return 'playwright'
  if (source.includes('vitest')) return 'vitest'
  if (source.includes('supertest')) return 'supertest'
  return 'jest'
}

function levelFor(file: string, source: string): TestCase['level'] {
  if (/e2e|playwright/i.test(file) || source.includes('@playwright/test')) return 'e2e'
  if (/contract/i.test(file) || source.includes('schemathesis')) return 'contract'
  if (/integration/i.test(file)) return 'integration'
  return 'unit'
}

function extractTests(repository: Repository, file: string, source: string): TestCase[] {
  const cases: TestCase[] = []
  const titlePattern = /\b(?:it|test)\s*\(\s*(['"`])([^\n]+?)\1/g
  const targets = [
    ...source.matchAll(/(?:get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\1/gi),
    ...source.matchAll(/(?:page\.goto|request\.(?:get|post|put|patch|delete))\s*\(\s*(['"`])([^'"`]+)\1/gi),
  ].map(match => match[2])
  const annotations = [...source.matchAll(/(?:api|flow|jira)['"]?\s*[,):]\s*(?:description:\s*)?['"]([^'"]+)['"]/gi)].map(
    match => match[1]
  )
  const assertionCount = (source.match(/\bexpect\s*\(/g) ?? []).length + (source.match(/\bassert\b/g) ?? []).length
  let match: RegExpExecArray | null
  while ((match = titlePattern.exec(source))) {
    const title = match[2].trim()
    cases.push({
      id: `test:${repository.name}:${digest(file, title)}`,
      repositoryId: repository.id,
      framework: frameworkFor(file, source),
      level: levelFor(file, source),
      title,
      sourcePath: normalize(file),
      assertionCount,
      targets: [...new Set([...targets, ...annotations])],
    })
  }
  if (!cases.length) {
    cases.push({
      id: `test:${repository.name}:${digest(file)}`,
      repositoryId: repository.id,
      framework: frameworkFor(file, source),
      level: levelFor(file, source),
      title: file.split('/').at(-1) ?? file,
      sourcePath: normalize(file),
      assertionCount,
      targets: [...new Set([...targets, ...annotations])],
    })
  }
  return cases
}

function stateHints(source: string) {
  const states = new Set<string>(['default'])
  const hints: Array<[RegExp, string]> = [
    [/\b(?:is)?loading\b|spinner|skeleton/i, 'loading'],
    [/\berror\b|failed|failure/i, 'error'],
    [/empty\s*state|no\s+(?:items|results|data)/i, 'empty'],
    [/disabled|permission|forbidden|unauthorized/i, 'denied'],
    [/success|complete|confirmed/i, 'success'],
  ]
  for (const [pattern, state] of hints) if (pattern.test(source)) states.add(state)
  return [...states]
}

async function scanFrontend(
  root: string,
  repository: Repository,
  ignore: string[],
  storyFiles: Set<string>
) {
  const packageFiles = await fg('**/package.json', { cwd: root, ignore })
  const surfaces: FrontendSurface[] = []
  const fingerprints: string[] = []
  const diagnostics: ScanDiagnostic[] = []
  for (const packageFile of packageFiles) {
    let packageJson: Record<string, unknown>
    try {
      const packageContent = await readText(root, packageFile)
      fingerprints.push(`${normalize(packageFile)}:${fingerprint(packageContent)}`)
      packageJson = JSON.parse(packageContent)
    } catch (error) {
      diagnostics.push({
        sourcePath: normalize(packageFile),
        category: 'frontend',
        severity: 'error',
        code: 'invalid-package-manifest',
        message: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    const packageRoot = normalize(packageFile.replace(/\/?package\.json$/, ''))
    const packageName = String(packageJson.name ?? repository.name)
    const sourceFiles = await fg(`${packageRoot ? `${packageRoot}/` : ''}{src,app,pages}/**/*.{ts,tsx,js,jsx}`, {
      cwd: root,
      ignore,
    })
    for (const file of sourceFiles) {
      let source: string
      try {
        source = await readText(root, file)
        fingerprints.push(`${normalize(file)}:${fingerprint(source)}`)
      } catch (error) {
        diagnostics.push({
          sourcePath: normalize(file),
          category: 'frontend',
          severity: 'error',
          code: 'unreadable-source',
          message: error instanceof Error ? error.message : String(error),
        })
        continue
      }
      const routeMatches = [
        ...source.matchAll(/(?:path|to)\s*[=:]\s*['"]([^'"]+)['"]/g),
      ]
      for (const routeMatch of routeMatches) {
        const routePath = routeMatch[1]
        if (!routePath.startsWith('/')) continue
        surfaces.push({
          id: `ui:${repository.name}:${packageName}:route:${routePath}`,
          repositoryId: repository.id,
          packageName,
          kind: 'route',
          name: routePath,
          sourcePath: normalize(file),
          routePath,
          public: true,
          states: stateHints(source),
          hasStory: false,
        })
      }

      const componentMatches = [
        ...source.matchAll(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/g),
      ]
      for (const componentMatch of componentMatches) {
        const name = componentMatch[1]
        const base = normalize(file).replace(/\.[^.]+$/, '')
        const hasStory = [...storyFiles].some(story => story.replace(/\.stories\.[^.]+$/, '') === base)
        surfaces.push({
          id: `ui:${repository.name}:${packageName}:component:${name}`,
          repositoryId: repository.id,
          packageName,
          kind: /page/i.test(name) ? 'page' : 'component',
          name,
          sourcePath: normalize(file),
          public: /(?:index\.|exports|export\s+)/.test(`${file} ${source}`),
          states: stateHints(source),
          hasStory,
        })
      }
    }
  }
  return {
    surfaces: [...new Map(surfaces.map(surface => [surface.id, surface])).values()],
    fingerprints,
    diagnostics,
  }
}

export async function scanRepository(repository: Repository, rootPath: string): Promise<ScanResult> {
  const root = safeRoot(rootPath)
  const ignore = [...DEFAULT_IGNORES, ...repository.excludeGlobs]
  const openApiFiles = await fg(
    repository.includeGlobs.length ? repository.includeGlobs : OPENAPI_GLOBS,
    { cwd: root, ignore, onlyFiles: true, followSymbolicLinks: false }
  )
  const testFiles = await fg(TEST_GLOBS, { cwd: root, ignore, onlyFiles: true, followSymbolicLinks: false })
  const storyFiles = new Set(
    await fg('**/*.stories.{ts,tsx,js,jsx,mdx}', {
      cwd: root,
      ignore,
      onlyFiles: true,
      followSymbolicLinks: false,
    })
  )

  const operations: ApiOperation[] = []
  const diagnostics: ScanDiagnostic[] = []
  const contentFingerprints: string[] = []
  for (const file of openApiFiles) {
    try {
      const content = await readText(root, file)
      contentFingerprints.push(`${normalize(file)}:${fingerprint(content)}`)
      operations.push(...parseOpenApi(repository, file, content))
    } catch (error) {
      diagnostics.push({
        sourcePath: normalize(file),
        category: 'openapi',
        severity: 'error',
        code: 'invalid-openapi-document',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const tests: TestCase[] = []
  for (const file of testFiles) {
    try {
      const content = await readText(root, file)
      contentFingerprints.push(`${normalize(file)}:${fingerprint(content)}`)
      tests.push(...extractTests(repository, normalize(file), content))
    } catch (error) {
      diagnostics.push({
        sourcePath: normalize(file),
        category: 'test',
        severity: 'error',
        code: 'unreadable-test-source',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const file of storyFiles) {
    try {
      const content = await readText(root, file)
      contentFingerprints.push(`${normalize(file)}:${fingerprint(content)}`)
    } catch (error) {
      diagnostics.push({
        sourcePath: normalize(file),
        category: 'storybook',
        severity: 'error',
        code: 'unreadable-story',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const frontend = await scanFrontend(root, repository, ignore, storyFiles)
  const surfaces = frontend.surfaces
  contentFingerprints.push(...frontend.fingerprints)
  diagnostics.push(...frontend.diagnostics)
  const expectations = [
    ...operations.flatMap(operation => buildApiExpectations(operation, tests)),
    ...surfaces.flatMap(surface => buildFrontendExpectations(surface, tests)),
  ]
  const findings = buildFindings(repository.id, operations, surfaces, expectations)
  const revision = digest(
    repository.name,
    ...contentFingerprints.sort()
  )

  return {
    repository,
    revision,
    operations,
    surfaces,
    tests,
    expectations,
    findings,
    diagnostics,
    scannedAt: new Date().toISOString(),
  }
}

export function isCredentialFreeRepositoryUrl(value: string) {
  try {
    const url = new URL(value)
    return !url.username && !url.password && ['https:', 'ssh:'].includes(url.protocol)
  } catch {
    return false
  }
}

export function relativeRepositoryPath(root: string, file: string) {
  return normalize(relative(safeRoot(root), resolve(file)))
}
