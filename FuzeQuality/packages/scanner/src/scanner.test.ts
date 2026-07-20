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
        - { name: id, in: path, required: true, schema: { type: string } }
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

    const result = await scanRepository(repository, root)
    expect(result.operations).toHaveLength(1)
    expect(result.operations[0].operationId).toBe('getUser')
    expect(result.surfaces.some(surface => surface.name === 'UserPage')).toBe(true)
    expect(result.tests.some(test => test.framework === 'supertest')).toBe(true)
    expect(result.expectations.some(item => item.kind === 'authentication-missing')).toBe(true)
  })

  it('rejects credentials embedded in repository URLs', () => {
    expect(isCredentialFreeRepositoryUrl('https://github.com/fuze/sample')).toBe(true)
    expect(isCredentialFreeRepositoryUrl('https://token@github.com/fuze/sample')).toBe(false)
  })
})
