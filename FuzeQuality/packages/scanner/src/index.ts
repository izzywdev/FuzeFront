import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import fg from 'fast-glob'
import { parse as parseYaml } from 'yaml'
import type {
  ApiOperation,
  FrontendSurface,
  StorybookStory,
  Repository,
  RepositoryScanCandidate,
  QualityArtifact,
  ScanDiagnostic,
  ScanResult,
  TestCase,
  TestExpectation,
} from '@fuzequality/contracts'
import {
  buildApiExpectations,
  buildFindings,
  buildFrontendExpectations,
} from '@fuzequality/core'
import { parseOpenApiDocument, referencedOpenApiPaths } from './openapi'

const digest = (...parts: string[]) =>
  createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)

const qualityArtifactId = (
  repositoryId: string,
  revision: string,
  kind: QualityArtifact['kind'],
  ...identity: string[]
) => `artifact:${repositoryId}:${digest(revision, kind, ...identity)}`

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

const OPENAPI_CONFIG_GLOBS = [
  '**/*openapi*.{ts,js,mjs,cjs}',
  '**/*swagger*.{ts,js,mjs,cjs}',
]

export const SCANNER_VERSION = '1.6.0'

const TEST_GLOBS = [
  '**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,py}',
  '**/test_*.py',
  '**/*_test.py',
  '**/tests/**/*.{ts,tsx,js,jsx,mjs,cjs,py}',
  '**/e2e/**/*.{ts,tsx,js,jsx,mjs,cjs,py}',
]

const QUALITY_ARTIFACT_GLOBS: Array<{ kind: QualityArtifact['kind']; glob: string }> = [
  { kind: 'policy', glob: '**/{policy,governance,compliance,security}*.{md,json,yaml,yml}' },
  { kind: 'gate', glob: '**/{gate,required-check,branch-protection}*.{ts,js,mjs,py,json,yaml,yml}' },
  // Workflow names are unconstrained (ci.yml, verify.yml, post-prod.yml, ...).
  // Treat every checked-in workflow as gate evidence and let the reviewed
  // policy/gate analysis decide whether it actually guards a policy.
  { kind: 'gate', glob: '**/.github/workflows/*.{yaml,yml}' },
  { kind: 'load-test', glob: '**/{load,performance,k6,artillery}/**/*.{ts,js,mjs,py,json,yaml,yml}' },
  { kind: 'load-test', glob: '**/{load,performance,k6,artillery}.{ts,js,mjs,py,json,yaml,yml}' },
  { kind: 'load-test', glob: '**/{load,load-test,performance,performance-test,k6,artillery}.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,py}' },
  { kind: 'load-test', glob: '**/.github/workflows/{load,load-test,performance,performance-test,k6,artillery}.{yaml,yml}' },
  { kind: 'stress-test', glob: '**/{stress,soak}/**/*.{ts,js,mjs,py,json,yaml,yml}' },
  { kind: 'stress-test', glob: '**/{stress,soak}.{ts,js,mjs,py,json,yaml,yml}' },
  { kind: 'stress-test', glob: '**/{stress,stress-test,soak,soak-test}.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,py}' },
  { kind: 'stress-test', glob: '**/.github/workflows/{stress,stress-test,soak,soak-test}.{yaml,yml}' },
]

function performanceExecutionTarget(
  kind: QualityArtifact['kind'],
  sourcePath: string,
  source: string,
): QualityArtifact['execution'] {
  if (
    !['load-test', 'stress-test'].includes(kind) ||
    !sourcePath.startsWith('.github/workflows/') ||
    !/\.ya?ml$/i.test(sourcePath)
  ) return undefined
  try {
    const document = parseYaml(source) as {
      on?: unknown
      'x-fuzequality-performance'?: unknown
    } | undefined
    const triggers = document?.on
    const reviewedKind = kind === 'load-test' ? 'load' : 'stress'
    const dispatchable = triggers === 'workflow_dispatch' ||
      (Array.isArray(triggers) && triggers.includes('workflow_dispatch')) ||
      (typeof triggers === 'object' && triggers !== null && 'workflow_dispatch' in triggers)
    return dispatchable && document?.['x-fuzequality-performance'] === reviewedKind
      ? { provider: 'github-actions', workflowPath: sourcePath, trigger: 'workflow_dispatch' }
      : undefined
  } catch {
    return undefined
  }
}

async function discoverQualityArtifacts(root: string, repository: Repository, ignore: string[]): Promise<{ artifacts: QualityArtifact[]; fingerprints: string[]; diagnostics: ScanDiagnostic[] }> {
  const artifacts = new Map<string, QualityArtifact>()
  const fingerprints = new Map<string, string>()
  const diagnostics = new Map<string, ScanDiagnostic>()
  const sources = new Map<string, Promise<string | undefined>>()
  const qualitySource = (file: string) => {
    const sourcePath = normalize(file)
    const existing = sources.get(sourcePath)
    if (existing) return existing
    const pending = readText(root, file).then(
      source => {
        fingerprints.set(sourcePath, `${sourcePath}:${fingerprint(source)}`)
        return source
      },
      error => {
        diagnostics.set(sourcePath, {
          sourcePath,
          category: 'repository',
          severity: 'error',
          code: 'unreadable-quality-evidence',
          message: error instanceof Error ? error.message : String(error),
        })
        return undefined
      },
    )
    sources.set(sourcePath, pending)
    return pending
  }
  for (const candidate of QUALITY_ARTIFACT_GLOBS) {
    const files = await fg(candidate.glob, { cwd: root, ignore, onlyFiles: true, dot: true })
    for (const file of files.slice(0, 100)) {
      const sourcePath = normalize(file)
      const source = await qualitySource(file)
      if (source === undefined) continue
      const evidence = source.split(/\r?\n/).filter(line => /policy|gate|threshold|load|stress|required|needs:|playwright|production|deploy|test/i.test(line)).slice(0, 8).map(line => line.trim()).filter(Boolean)
      const key = `${candidate.kind}:${sourcePath}`
      artifacts.set(key, {
        id: `artifact:${repository.id}:${digest(candidate.kind, sourcePath)}`,
        repositoryId: repository.id,
        kind: candidate.kind,
        title: sourcePath.split('/').at(-1) ?? sourcePath,
        sourcePath,
        summary: `${candidate.kind.replace('-', ' ')} evidence discovered during repository analysis`,
        evidence,
        execution: performanceExecutionTarget(candidate.kind, sourcePath, source),
      })
    }
  }
  const documentationFiles = await fg('**/*.{md,mdx}', { cwd: root, ignore, onlyFiles: true, dot: true, followSymbolicLinks: false })
  for (const file of documentationFiles.slice(0, 100)) {
    const sourcePath = normalize(file)
    const source = await qualitySource(file)
    if (source === undefined) continue
    const heading = source.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim()
    const evidence = source
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => /user|journey|flow|screen|route|step|test|policy|gate|release|production/i.test(line))
      .slice(0, 8)
    const key = `documentation:${sourcePath}`
    artifacts.set(key, {
      id: `artifact:${repository.id}:${digest('documentation', sourcePath)}`,
      repositoryId: repository.id,
      kind: 'documentation',
      title: heading || sourcePath.split('/').at(-1) || sourcePath,
      sourcePath,
      summary: heading ? `Repository documentation: ${heading}` : 'Repository documentation discovered during analysis',
      evidence,
    })
  }
  return {
    artifacts: [...artifacts.values()].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath) || left.kind.localeCompare(right.kind)),
    fingerprints: [...fingerprints.values()],
    diagnostics: [...diagnostics.values()].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
  }
}

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
  const titleMatches = file.endsWith('.py')
    ? [...source.matchAll(/^[ \t]*(?:async\s+)?def\s+(test_[A-Za-z0-9_]+)\s*\(/gm)].map(match => ({
        index: match.index ?? 0,
        title: match[1].replace(/^test_/, '').replace(/_+/g, ' '),
      }))
    : [...source.matchAll(/\b(?:it|test)\s*\(\s*(['"`])([^\n]+?)\1/g)].map(match => ({
        index: match.index ?? 0,
        title: match[2].trim(),
      }))
  const metadata = (segment: string) => {
    const routeMatches = [
      ...segment.matchAll(/\b(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/gi),
      ...segment.matchAll(/\brequest\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/gi),
    ]
    const routes = routeMatches.map(match => ({ method: match[1].toLowerCase(), path: match[3] }))
    const explicitTargets = [...segment.matchAll(/@fuzequality\s+(?:api|target)\s+([^\s*]+)/gi)].map(match => match[1])
    const annotations = [...segment.matchAll(/(?:api|flow|jira)['"]?\s*[,):]\s*(?:description:\s*)?['"]([^'"]+)['"]/gi)].map(
      match => match[1]
    )
    const operationIds = [...segment.matchAll(/\boperationId\s*[:=]\s*['"]([^'"]+)['"]/gi)].map(match => match[1])
    return {
      routes,
      explicitTargets,
      operationIds,
      assertionCount: (segment.match(/\bexpect\s*\(/g) ?? []).length + (segment.match(/\bassert\b/g) ?? []).length,
      targets: [...new Set([...routes.map(route => route.path), ...annotations, ...explicitTargets, ...operationIds])],
    }
  }
  for (const [index, match] of titleMatches.entries()) {
    const title = match.title
    const start = match.index
    const end = titleMatches[index + 1]?.index ?? source.length
    const evidence = metadata(source.slice(start, end))
    cases.push({
      id: `test:${repository.name}:${digest(file, title, String(start))}`,
      repositoryId: repository.id,
      framework: frameworkFor(file, source),
      level: levelFor(file, source),
      title,
      sourcePath: normalize(file),
      assertionCount: evidence.assertionCount,
      targets: evidence.targets,
      explicitTargets: evidence.explicitTargets,
      operationIds: evidence.operationIds,
      routes: evidence.routes,
    })
  }
  if (!cases.length) {
    const evidence = metadata(source)
    cases.push({
      id: `test:${repository.name}:${digest(file)}`,
      repositoryId: repository.id,
      framework: frameworkFor(file, source),
      level: levelFor(file, source),
      title: file.split('/').at(-1) ?? file,
      sourcePath: normalize(file),
      assertionCount: evidence.assertionCount,
      targets: evidence.targets,
      explicitTargets: evidence.explicitTargets,
      operationIds: evidence.operationIds,
      routes: evidence.routes,
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

function storySlug(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

// Hardcoded patterns for the `<Export>.storyName = '...'` / `<Export>.play = ...`
// assignment forms. The export name is compared against the captured identifier
// afterwards rather than interpolated into a pattern, so no regex is ever built
// from scanned source text (ReDoS-safe) and the identifier has to match in full
// instead of as a substring.
const STORY_NAME_ASSIGNMENT = /\b([A-Z][A-Za-z0-9_]*)\.storyName\s*=\s*['"]([^'"]+)['"]/g
const STORY_PLAY_ASSIGNMENT = /\b([A-Z][A-Za-z0-9_]*)\.play\s*=/g

function storyDisplayName(exportName: string, source: string) {
  for (const match of source.matchAll(STORY_NAME_ASSIGNMENT)) {
    if (match[1] === exportName) return match[2]
  }
  return exportName.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

function hasPlayAssignment(exportName: string, source: string) {
  for (const match of source.matchAll(STORY_PLAY_ASSIGNMENT)) {
    if (match[1] === exportName) return true
  }
  return false
}

function extractStories(sourcePath: string, source: string): Array<StorybookStory & { componentName?: string }> {
  const title = source.match(/\btitle\s*:\s*['"]([^'"]+)['"]/)?.[1]
    ?? sourcePath.replace(/\.stories\.[^.]+$/, '').split('/').pop()
    ?? 'Component'
  const componentName = source.match(/\bcomponent\s*:\s*([A-Z][A-Za-z0-9_]*)/)?.[1]
  const exports = [...source.matchAll(/export\s+(?:const|function)\s+([A-Z][A-Za-z0-9_]*)/g)]
    .map(match => ({ name: match[1], index: match.index ?? 0 }))
    .filter(item => !['Meta', 'Story', 'StoryObj'].includes(item.name))
  return exports.map((item, index) => {
    const exportName = item.name
    const id = `${storySlug(title)}--${storySlug(exportName)}`
    const exportBlock = source.slice(item.index, exports[index + 1]?.index ?? source.length)
    return {
      id,
      title,
      name: storyDisplayName(exportName, source),
      exportName,
      sourcePath: normalize(sourcePath),
      hasPlay: /\bplay\s*:/.test(exportBlock) || hasPlayAssignment(exportName, source),
      previewPath: `iframe.html?id=${encodeURIComponent(id)}&viewMode=story`,
      componentName,
    }
  })
}

async function scanFrontend(
  root: string,
  repository: Repository,
  ignore: string[],
  stories: Array<StorybookStory & { componentName?: string }>,
  storyFiles: Set<string>,
  onProgress: () => Promise<void>
) {
  const packageFiles = await fg('**/package.json', { cwd: root, ignore })
  const surfaces: FrontendSurface[] = []
  const fingerprints: string[] = []
  const diagnostics: ScanDiagnostic[] = []
  for (const packageFile of packageFiles) {
    await onProgress()
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
      if (storyFiles.has(normalize(file))) continue
      await onProgress()
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
          stories: [],
        })
      }

      const componentMatches = [
        ...source.matchAll(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/g),
      ]
      for (const componentMatch of componentMatches) {
        const name = componentMatch[1]
        const base = normalize(file).replace(/\.[^.]+$/, '')
        const componentStories = stories
          .filter(story =>
            story.componentName === name ||
            story.sourcePath.replace(/\.stories\.[^.]+$/, '') === base
          )
          .map(({ componentName: _componentName, ...story }) => story)
        surfaces.push({
          id: `ui:${repository.name}:${packageName}:component:${name}`,
          repositoryId: repository.id,
          packageName,
          kind: /page/i.test(name) ? 'page' : 'component',
          name,
          sourcePath: normalize(file),
          public: /(?:index\.|exports|export\s+)/.test(`${file} ${source}`),
          states: stateHints(source),
          hasStory: componentStories.length > 0,
          stories: componentStories,
        })
      }
    }
  }
  return {
    surfaces: [...new Map(surfaces.map(surface => [surface.id, surface])).values()],
    packageFiles: packageFiles.map(normalize),
    fingerprints,
    diagnostics,
  }
}

export async function scanRepository(
  repository: Repository,
  rootPath: string,
  options: { onProgress?: () => Promise<void>; sourceRevision?: string } = {}
): Promise<ScanResult> {
  const root = safeRoot(rootPath)
  const onProgress = options.onProgress ?? (async () => {})
  const ignore = [...DEFAULT_IGNORES, ...repository.excludeGlobs]
  const configuredOpenApiGlobs = repository.includeGlobs.length ? repository.includeGlobs : OPENAPI_GLOBS
  const directOpenApiFiles = await fg(
    configuredOpenApiGlobs,
    { cwd: root, ignore, onlyFiles: true, followSymbolicLinks: false }
  )
  const configFiles = await fg(OPENAPI_CONFIG_GLOBS, {
    cwd: root, ignore, onlyFiles: true, followSymbolicLinks: false,
  })
  const referencedFiles: string[] = []
  for (const configFile of configFiles) {
    await onProgress()
    try {
      const source = await readText(root, configFile)
      for (const referenced of referencedOpenApiPaths(source)) {
        referencedFiles.push(normalize(relative(root, resolve(root, dirname(configFile), referenced))))
      }
    } catch {
      // Config parsing is best-effort; candidate documents still receive diagnostics below.
    }
  }
  const openApiFiles = [...new Set([...directOpenApiFiles, ...referencedFiles])]
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
    await onProgress()
    try {
      const content = await readText(root, file)
      contentFingerprints.push(`${normalize(file)}:${fingerprint(content)}`)
      const parsed = await parseOpenApiDocument(root, repository, file, content)
      operations.push(...parsed.operations)
      diagnostics.push(...parsed.diagnostics)
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
    await onProgress()
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

  const stories: Array<StorybookStory & { componentName?: string }> = []
  for (const file of storyFiles) {
    await onProgress()
    try {
      const content = await readText(root, file)
      contentFingerprints.push(`${normalize(file)}:${fingerprint(content)}`)
      stories.push(...extractStories(normalize(file), content))
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

  const frontend = await scanFrontend(root, repository, ignore, stories, storyFiles, onProgress)
  const surfaces = frontend.surfaces
  contentFingerprints.push(...frontend.fingerprints)
  diagnostics.push(...frontend.diagnostics)
  const expectations: TestExpectation[] = []
  for (const operation of operations) {
    await onProgress()
    expectations.push(...buildApiExpectations(operation, tests))
  }
  for (const surface of surfaces) {
    await onProgress()
    expectations.push(...buildFrontendExpectations(surface, tests))
  }
  const owner = repository.ownership?.team
  const findings = buildFindings(repository.id, operations, surfaces, expectations, owner)
  const discoveredQuality = await discoverQualityArtifacts(root, repository, ignore)
  contentFingerprints.push(...discoveredQuality.fingerprints)
  diagnostics.push(...discoveredQuality.diagnostics)
  const revision = digest(
    repository.name,
    SCANNER_VERSION,
    ...contentFingerprints.sort()
  )
  const qualityArtifacts = [
    ...surfaces.filter(surface => surface.routePath).map(surface => ({
      id: qualityArtifactId(repository.id, revision, 'route', surface.sourcePath),
      repositoryId: repository.id,
      kind: 'route' as const,
      title: surface.name,
      sourcePath: surface.sourcePath,
      summary: `Frontend route ${surface.routePath}`,
      evidence: [surface.routePath!],
    })),
    ...operations.map(operation => ({
      id: qualityArtifactId(repository.id, revision, 'route', operation.documentPath, operation.method, operation.path),
      repositoryId: repository.id,
      kind: 'route' as const,
      title: `${operation.method.toUpperCase()} ${operation.path}`,
      sourcePath: operation.documentPath,
      summary: operation.summary,
      evidence: [operation.operationId ?? operation.path],
    })),
    ...stories.map(story => ({
      id: qualityArtifactId(repository.id, revision, 'story', story.sourcePath, story.id),
      repositoryId: repository.id,
      kind: 'story' as const,
      title: `${story.title} / ${story.name}`,
      sourcePath: story.sourcePath,
      summary: `Storybook interaction surface ${story.previewPath}`,
      evidence: [story.previewPath, ...(story.hasPlay ? ['play-function'] : [])],
    })),
    ...tests.map(test => ({
      id: qualityArtifactId(repository.id, revision, 'test-plan', test.sourcePath, test.id),
      repositoryId: repository.id,
      kind: 'test-plan' as const,
      title: test.title,
      sourcePath: test.sourcePath,
      summary: `${test.level} ${test.framework} test discovered during repository analysis`,
      evidence: [...new Set([test.id, ...test.targets])].slice(0, 20),
    })),
    ...discoveredQuality.artifacts.map(item => ({
      ...item,
      id: qualityArtifactId(repository.id, revision, item.kind, item.sourcePath),
    })),
  ]
  for (const diagnostic of diagnostics.filter(item => item.category === 'openapi')) {
    findings.push({
      id: `finding:${repository.name}:${digest(diagnostic.sourcePath, diagnostic.code)}`,
      repositoryId: repository.id,
      type: diagnostic.code,
      severity: diagnostic.severity === 'error' ? 'high' : 'medium',
      title: `${diagnostic.code}: ${diagnostic.sourcePath}`,
      detail: diagnostic.message,
      owner,
      remediation: diagnostic.code.includes('ref')
        ? 'Repair or internalize the referenced schema path and rescan.'
        : 'Correct the OpenAPI document so it validates without executing repository code.',
      status: 'open',
    })
  }
  const candidate = (
    sourcePath: string,
    kind: RepositoryScanCandidate['kind']
  ): RepositoryScanCandidate => {
    const candidateDiagnostics = diagnostics.filter(item => item.sourcePath === normalize(sourcePath))
    return {
      sourcePath: normalize(sourcePath),
      kind,
      status: candidateDiagnostics.some(item => item.severity === 'error')
        ? (operations.some(item => item.documentPath === normalize(sourcePath)) ? 'partial' : 'invalid')
        : kind === 'openapi-config' ? 'discovered' : 'parsed',
      diagnosticCodes: [...new Set(candidateDiagnostics.map(item => item.code))].sort(),
    }
  }
  const candidates = [
    ...openApiFiles.map(file => candidate(file, 'openapi-document')),
    ...configFiles.map(file => candidate(file, 'openapi-config')),
    ...testFiles.map(file => candidate(file, 'test')),
    ...[...storyFiles].map(file => candidate(file, 'storybook')),
    ...frontend.packageFiles.map(file => candidate(file, 'package')),
  ].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath) || left.kind.localeCompare(right.kind))
  const configVersion = digest(JSON.stringify({
    includeGlobs: repository.includeGlobs,
    excludeGlobs: repository.excludeGlobs,
    kind: repository.kind,
  }))

  return {
    repository,
    revision,
    operations,
    surfaces,
    tests,
    expectations,
    findings,
    diagnostics,
    qualityArtifacts,
    scanDetails: {
      sourceRevision: options.sourceRevision,
      catalogRevision: revision,
      scannerVersion: SCANNER_VERSION,
      configVersion,
      partial: diagnostics.some(item => item.severity === 'error'),
      candidates,
      counts: {
        candidates: candidates.length,
        operations: operations.length,
        frontendSurfaces: surfaces.length,
        tests: tests.length,
        diagnostics: diagnostics.length,
      },
    },
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
