import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Repository } from '@fuzequality/contracts'
import { isCredentialFreeRepositoryUrl, scanRepository } from './index'

const repository: Repository = {
  id: 'b4908e35-8a57-4c13-9366-489ec59071fe',
  owner: 'fuze',
  name: 'sample',
  canonicalUrl: 'https://github.com/fuze/sample',
  defaultBranch: 'main',
  kind: 'mixed',
  enabled: true,
  includeGlobs: [],
  excludeGlobs: [],
  jiraProjects: [],
  jiraBindings: [],
  lastScanStatus: 'never',
}

describe('repository scanner', () => {
  it('builds API and frontend expectations from repository files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-'))
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'tests'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fuze/sample' }))
    await writeFile(
      join(root, 'openapi.yaml'),
      `openapi: 3.0.0
info: { title: Sample, version: 1.0.0 }
paths:
  /users/{id}:
    get:
      operationId: getUser
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, minLength: 4, pattern: '^[a-z0-9]+$' } }
      responses: { '200': { description: ok }, '404': { description: missing } }
`
    )
    await writeFile(
      join(root, 'src', 'UserPage.tsx'),
      `export function UserPage() { const loading = false; return <div>User</div> }
       export const route = { path: '/users/:id' }`
    )
    await writeFile(
      join(root, 'tests', 'users.test.ts'),
      `import request from 'supertest'; test('getUser returns a user', async () => { expect(await request(app).get('/users/42')).toBeTruthy() })`
    )

    const result = await scanRepository(repository, root, { sourceRevision: 'a'.repeat(40) })
    expect(result.operations).toHaveLength(1)
    expect(result.operations[0].operationId).toBe('getUser')
    expect(result.surfaces.some(surface => surface.name === 'UserPage')).toBe(true)
    expect(result.tests.some(test => test.framework === 'supertest')).toBe(true)
    expect(result.expectations.some(item => item.kind === 'authentication-missing')).toBe(true)
    expect(result.expectations.find(item => item.kind === 'happy-path')?.coverage).toBe('covered-explicit')
    expect(result.expectations.find(item => item.kind === 'authentication-missing')?.coverage).toBe('gap')
    expect(result.expectations.find(item => item.kind === 'missing-path-id')?.coverage).toBe('gap')
    expect(result.expectations.some(item => item.kind === 'parameter-path-id-minlength')).toBe(true)
    expect(result.expectations.some(item => item.kind === 'parameter-path-id-pattern')).toBe(true)
    expect(result.expectations.find(item => item.kind === 'response-200')?.coverage).toBe('gap')
    expect(result.scanDetails).toMatchObject({
      sourceRevision: 'a'.repeat(40),
      scannerVersion: '1.2.0',
      partial: false,
      counts: {
        operations: 1,
        tests: 1,
        diagnostics: 0,
      },
    })
    expect(result.scanDetails.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: 'openapi.yaml', kind: 'openapi-document', status: 'parsed' }),
      expect.objectContaining({ sourcePath: 'package.json', kind: 'package', status: 'parsed' }),
      expect.objectContaining({ sourcePath: 'tests/users.test.ts', kind: 'test', status: 'parsed' }),
    ]))
  })

  it('catalogs Storybook CSF stories and maps their visual states to components', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-storybook-'))
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fuze/design' }))
    await writeFile(join(root, 'src', 'Button.tsx'), `export function Button() { return <button>Save</button> }`)
    await writeFile(join(root, 'src', 'Button.stories.tsx'), `
      import { Button } from './Button'
      export default { title: 'Design/Button', component: Button }
      export const Primary = { args: { children: 'Save' } }
      export const Loading = { args: { loading: true }, play: async () => {} }
      Loading.storyName = 'Saving'
    `)

    const result = await scanRepository(repository, root)
    const button = result.surfaces.find(surface => surface.name === 'Button')

    expect(button).toEqual(expect.objectContaining({
      hasStory: true,
      stories: [
        expect.objectContaining({
          id: 'design-button--primary',
          name: 'Primary',
          previewPath: 'iframe.html?id=design-button--primary&viewMode=story',
          hasPlay: false,
        }),
        expect.objectContaining({
          id: 'design-button--loading',
          name: 'Saving',
          hasPlay: true,
        }),
      ],
    }))
    expect(result.expectations.find(item => item.kind === 'storybook')?.coverage).toBe('covered-explicit')
  })

  it('credits scenario coverage only to assertion-bearing tests that name the scenario', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-evidence-'))
    await mkdir(join(root, 'tests'), { recursive: true })
    await writeFile(
      join(root, 'openapi.yaml'),
      `openapi: 3.0.0
info: { title: Sample, version: 1.0.0 }
paths:
  /users/{id}:
    get:
      operationId: getUser
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses: { '200': { description: ok }, '401': { description: unauthenticated }, '404': { description: missing } }
`
    )
    await writeFile(
      join(root, 'tests', 'users.test.ts'),
      `test('getUser returns status 200', () => { expect(true).toBe(true) })
       test('getUser rejects missing auth with 401', () => { expect(true).toBe(true) })
       test('getUser handles 404 not found', () => { expect(true).toBe(true) })`
    )

    const result = await scanRepository(repository, root)
    expect(result.expectations.find(item => item.kind === 'authentication-missing')?.coverage).toBe('covered-explicit')
    expect(result.expectations.find(item => item.kind === 'response-200')?.coverage).toBe('covered-explicit')
    expect(result.expectations.find(item => item.kind === 'response-404')?.coverage).toBe('covered-explicit')
    expect(result.expectations.find(item => item.kind === 'missing-path-id')?.coverage).toBe('gap')
  })

  it('discovers root-level pytest functions and preserves per-scenario evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-pytest-'))
    await writeFile(
      join(root, 'openapi.yaml'),
      `openapi: 3.0.0
info: { title: Sample, version: 1.0.0 }
paths:
  /users/{id}:
    get:
      operationId: getUser
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses: { '200': { description: ok }, '401': { description: unauthenticated }, '404': { description: missing } }
`
    )
    await writeFile(
      join(root, 'test_users.py'),
      `def test_get_user_returns_200(client):
    # @fuzequality api api:sample:openapi.yaml:getUser
    response = client.get('/users/42')
    assert response.status_code == 200

def test_get_user_missing_auth_returns_401(client):
    # @fuzequality api api:sample:openapi.yaml:getUser
    response = client.get('/users/42')
    assert response.status_code == 401

async def test_get_user_missing_id_returns_404(client):
    # @fuzequality api api:sample:openapi.yaml:getUser
    response = client.get('/users/')
    assert response.status_code == 404
`
    )

    const result = await scanRepository(repository, root)

    expect(result.tests.map(test => test.title)).toEqual([
      'get user returns 200',
      'get user missing auth returns 401',
      'get user missing id returns 404',
    ])
    expect(result.tests.every(test => test.assertionCount === 1)).toBe(true)
    expect(result.tests.every(test => test.explicitTargets?.includes('api:sample:openapi.yaml:getUser'))).toBe(true)
    expect(result.expectations.find(item => item.kind === 'happy-path')?.coverage).toBe('covered-explicit')
    expect(result.expectations.find(item => item.kind === 'authentication-missing')?.coverage).toBe('covered-explicit')
    expect(result.expectations.find(item => item.kind === 'missing-path-id')?.coverage).toBe('covered-explicit')
    expect(result.expectations.find(item => item.kind === 'response-200')?.coverage).toBe('covered-explicit')
  })

  it('rejects credentials embedded in repository URLs', () => {
    expect(isCredentialFreeRepositoryUrl('https://github.com/fuze/sample')).toBe(true)
    expect(isCredentialFreeRepositoryUrl('https://token@github.com/fuze/sample')).toBe(false)
  })

  it('changes the revision when inventory content changes without renaming files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-revision-'))
    const spec = join(root, 'openapi.yaml')
    await writeFile(spec, `openapi: 3.0.0\ninfo: { title: Sample, version: 1.0.0 }\npaths: {}`)
    const first = await scanRepository(repository, root)
    await writeFile(spec, `openapi: 3.0.0\ninfo: { title: Sample, version: 1.0.1 }\npaths: {}`)
    const second = await scanRepository(repository, root)
    expect(second.revision).not.toBe(first.revision)
  })

  it('reports malformed OpenAPI documents without aborting the repository scan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-diagnostic-'))
    await writeFile(join(root, 'openapi.yaml'), 'openapi: [not valid')
    const result = await scanRepository(repository, root)
    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        sourcePath: 'openapi.yaml',
        category: 'openapi',
        severity: 'error',
        code: 'invalid-openapi-document',
      }),
    ])
    expect(result.scanDetails).toMatchObject({
      partial: true,
      candidates: [
        expect.objectContaining({
          sourcePath: 'openapi.yaml',
          status: 'invalid',
          diagnosticCodes: ['invalid-openapi-document'],
        }),
      ],
    })
  })

  it.each([
    ['Swagger 2.0', `swagger: '2.0'\ninfo: { title: Legacy, version: 1.0.0 }\npaths: { /health: { get: { responses: { '200': { description: ok } } } } }`],
    ['OpenAPI 3.0', `openapi: 3.0.3\ninfo: { title: Current, version: 1.0.0 }\npaths: { /health: { get: { responses: { '200': { description: ok } } } } }`],
    ['OpenAPI 3.1', `openapi: 3.1.1\ninfo: { title: Modern, version: 1.0.0 }\npaths: { /health: { get: { responses: { '200': { description: ok } } } } }`],
  ])('discovers and validates %s documents', async (_label, document) => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-versions-'))
    await writeFile(join(root, 'swagger.yaml'), document)
    const result = await scanRepository(repository, root)
    expect(result.operations).toHaveLength(1)
    expect(result.diagnostics).toHaveLength(0)
  })

  it('retains operations and reports structurally invalid OpenAPI documents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-structural-validation-'))
    await writeFile(join(root, 'openapi.yaml'), `openapi: 3.0.3
info:
  title: Missing version
paths:
  /health:
    get:
      operationId: health
      responses: { '200': { description: ok } }
`)

    const result = await scanRepository(repository, root)

    expect(result.operations.map(operation => operation.operationId)).toEqual(['health'])
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourcePath: 'openapi.yaml',
        code: 'openapi-structural-validation',
      }),
    ]))
    expect(result.diagnostics.every(diagnostic => !diagnostic.message.includes(root))).toBe(true)
  })

  it('discovers a statically referenced specification without executing its config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-static-ref-'))
    await mkdir(join(root, 'config'), { recursive: true })
    await mkdir(join(root, 'specs'), { recursive: true })
    await writeFile(join(root, 'config', 'swagger.config.ts'), `throw new Error('must not execute'); export const spec = '../specs/service.yaml'`)
    await writeFile(join(root, 'specs', 'service.yaml'), `openapi: 3.1.0\ninfo: { title: Service, version: 1.0.0 }\npaths: { /ready: { get: { operationId: readiness, responses: { '200': { description: ok } } } } }`)
    const result = await scanRepository(repository, root)
    expect(result.operations.map(operation => operation.operationId)).toContain('readiness')
  })

  it('isolates unresolved and escaping references as findings without losing valid operations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-refs-'))
    await writeFile(join(root, 'openapi.yaml'), `openapi: 3.1.0
info: { title: Refs, version: 1.0.0 }
paths:
  /safe:
    get:
      operationId: safe
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: './missing.yaml#/Thing' } } } }
  /escape:
    get:
      responses:
        '200': { description: no, content: { application/json: { schema: { $ref: '../secret.yaml' } } } }
`)
    const result = await scanRepository(repository, root)
    expect(result.operations).toHaveLength(2)
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(
      expect.arrayContaining(['unresolved-openapi-ref', 'openapi-ref-outside-repository'])
    )
  })

  it('bundles referenced path items, parameters, request bodies, and responses with provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-bundled-'))
    await mkdir(join(root, 'paths'), { recursive: true })
    await mkdir(join(root, 'components'), { recursive: true })
    await writeFile(join(root, 'openapi.yaml'), `openapi: 3.1.0
info: { title: Bundled Service, version: 2.4.0 }
servers: [{ url: https://api.example.test }]
paths:
  /orders/{id}:
    $ref: './paths/orders.yaml#/order'
`)
    await writeFile(join(root, 'paths', 'orders.yaml'), `order:
  get:
    operationId: getOrder
    parameters:
      - $ref: '../components/common.yaml#/parameters/OrderId'
    responses:
      '200':
        $ref: '../components/common.yaml#/responses/Order'
  put:
    operationId: replaceOrder
    requestBody:
      $ref: '../components/common.yaml#/requestBodies/Order'
    responses:
      '200':
        $ref: '../components/common.yaml#/responses/Order'
`)
    await writeFile(join(root, 'components', 'common.yaml'), `parameters:
  OrderId: { name: id, in: path, required: true, schema: { type: string, minLength: 3 } }
requestBodies:
  Order:
    required: true
    content:
      application/json: { schema: { type: object } }
responses:
  Order:
    description: ok
    content:
      application/json: { schema: { type: object } }
`)

    const result = await scanRepository(repository, root)
    const getOrder = result.operations.find(operation => operation.operationId === 'getOrder')
    const replaceOrder = result.operations.find(operation => operation.operationId === 'replaceOrder')

    expect(getOrder).toEqual(expect.objectContaining({
      specificationVersion: '3.1.0',
      documentTitle: 'Bundled Service',
      documentVersion: '2.4.0',
      servers: ['https://api.example.test'],
      responseContentTypes: ['application/json'],
    }))
    expect(getOrder?.parameters).toEqual([
      expect.objectContaining({ name: 'id', location: 'path', required: true }),
    ])
    expect(getOrder?.sourcePaths).toEqual(expect.arrayContaining([
      'openapi.yaml',
      'paths/orders.yaml',
      'components/common.yaml',
    ]))
    expect(replaceOrder).toEqual(expect.objectContaining({
      requestBodyRequired: true,
      requestContentTypes: ['application/json'],
      responseContentTypes: ['application/json'],
    }))
    expect(result.diagnostics).toHaveLength(0)
  })

  it('rejects remote OpenAPI references without fetching them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-remote-ref-'))
    await writeFile(join(root, 'openapi.yaml'), `openapi: 3.1.0
info: { title: Remote, version: 1.0.0 }
paths:
  /remote:
    $ref: 'https://untrusted.example.test/path.yaml'
`)
    const result = await scanRepository(repository, root)
    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'openapi-ref-outside-repository' }),
    ]))
  })

  it('isolates an invalid split contract without losing operations from another document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-isolated-split-'))
    await mkdir(join(root, 'contracts'), { recursive: true })
    await writeFile(join(root, 'contracts', 'valid.openapi.yaml'), `openapi: 3.1.0
info: { title: Valid, version: 1.0.0 }
paths:
  /health:
    get:
      operationId: health
      responses: { '200': { description: ok } }
`)
    await writeFile(join(root, 'contracts', 'invalid.openapi.yaml'), `openapi: 3.1.0
info: { title: Invalid, version: 1.0.0 }
paths:
  /orders:
    $ref: './missing-path.yaml#/orders'
`)

    const result = await scanRepository(repository, root)

    expect(result.operations.map(operation => operation.operationId)).toEqual(['health'])
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourcePath: 'contracts/invalid.openapi.yaml',
        code: 'unresolved-openapi-ref',
      }),
    ]))
  })

  it('reports missing reference fragments without aborting sibling operations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-missing-fragment-'))
    await mkdir(join(root, 'components'), { recursive: true })
    await writeFile(join(root, 'components', 'responses.yaml'), `responses:
  Found: { description: found }
`)
    await writeFile(join(root, 'openapi.yaml'), `openapi: 3.1.0
info: { title: Fragment, version: 1.0.0 }
paths:
  /safe:
    get:
      operationId: safe
      responses: { '200': { description: ok } }
  /missing:
    get:
      operationId: missingFragment
      responses:
        '404': { $ref: './components/responses.yaml#/responses/Absent' }
`)

    const result = await scanRepository(repository, root)

    expect(result.operations.map(operation => operation.operationId)).toEqual(
      expect.arrayContaining(['safe', 'missingFragment'])
    )
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unresolved-openapi-ref' }),
    ]))
  })

  it('terminates cyclic catalog-entity references with a redacted diagnostic', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-cyclic-ref-'))
    await mkdir(join(root, 'paths'), { recursive: true })
    await writeFile(join(root, 'openapi.yaml'), `openapi: 3.1.0
info: { title: Cyclic, version: 1.0.0 }
paths:
  /cycle:
    $ref: './paths/a.yaml#/path'
`)
    await writeFile(join(root, 'paths', 'a.yaml'), `path:
  $ref: './b.yaml#/path'
`)
    await writeFile(join(root, 'paths', 'b.yaml'), `path:
  $ref: './a.yaml#/path'
`)

    const result = await scanRepository(repository, root)

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'cyclic-openapi-ref' }),
    ]))
    expect(result.diagnostics.every(diagnostic => !diagnostic.message.includes(root))).toBe(true)
  })

  it('produces identical catalog evidence when the same split revision is scanned twice', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-split-idempotency-'))
    await mkdir(join(root, 'paths'), { recursive: true })
    await writeFile(join(root, 'openapi.yaml'), `openapi: 3.1.0
info: { title: Stable, version: 1.0.0 }
paths:
  /stable:
    $ref: './paths/stable.yaml#/path'
`)
    await writeFile(join(root, 'paths', 'stable.yaml'), `path:
  get:
    operationId: stable
    responses: { '200': { description: ok } }
`)

    const first = await scanRepository(repository, root)
    const second = await scanRepository(repository, root)

    expect(second.revision).toBe(first.revision)
    expect(second.operations).toEqual(first.operations)
    expect(second.expectations).toEqual(first.expectations)
    expect(second.diagnostics).toEqual(first.diagnostics)
  })

  it('normalizes fallback identities and reports missing and duplicate operation identifiers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-identities-'))
    await writeFile(join(root, 'openapi.yaml'), `openapi: 3.0.0
info: { title: Identities, version: 1.0.0 }
paths:
  /users/{userId}/:
    get: { responses: { '200': { description: ok } } }
    post: { operationId: duplicate, responses: { '201': { description: ok } } }
  /groups:
    get: { operationId: duplicate, responses: { '200': { description: ok } } }
`)
    const result = await scanRepository(repository, root)
    expect(result.operations.find(operation => !operation.operationId)?.id).toContain('GET:/users/{}')
    expect(result.findings.filter(finding => finding.type === 'duplicate-operation-id')).toHaveLength(2)
    expect(result.findings.some(finding => finding.type === 'missing-operation-id')).toBe(true)
  })

  it('creates deterministic content, idempotency, response, and lifecycle expectations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-policy-'))
    await writeFile(join(root, 'openapi.yaml'), `openapi: 3.0.0
info: { title: Policy, version: 1.0.0 }
paths:
  /orders/{id}:
    put:
      operationId: replaceOrder
      parameters:
        - { name: Idempotency-Key, in: header, required: true, schema: { type: string } }
      requestBody: { content: { application/json: { schema: { type: object } } } }
      responses:
        '200': { description: ok, content: { application/json: { schema: { type: object } } } }
        '404': { description: missing }
`)
    const result = await scanRepository(repository, root)
    const kinds = result.expectations.map(expectation => expectation.kind)
    expect(kinds).toEqual(expect.arrayContaining([
      'invalid-content-type', 'request-content-type', 'response-content-type',
      'idempotency-replay', 'crud-sequence', 'response-200', 'response-404',
    ]))
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'required-test-gap',
        remediation: expect.stringContaining('assertion-bearing test'),
      }),
    ]))
  })

  it('turns OpenAPI diagnostics and undocumented errors into owned remediation findings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fuzequality-findings-'))
    await writeFile(join(root, 'openapi.yaml'), `openapi: 3.1.0
info: { title: Findings, version: 1.0.0 }
paths:
  /health:
    get:
      operationId: health
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: './missing.yaml' } } } }
`)
    const result = await scanRepository({
      ...repository,
      ownership: { team: 'Platform QA' },
    }, root)
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'unresolved-openapi-ref',
        owner: 'Platform QA',
        remediation: expect.any(String),
      }),
      expect.objectContaining({
        type: 'undocumented-error-response',
        owner: 'Platform QA',
      }),
    ]))
  })

})
