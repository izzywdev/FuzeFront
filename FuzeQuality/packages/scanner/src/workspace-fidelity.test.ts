import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Repository } from '@fuzequality/contracts'
import { SCANNER_VERSION, scanRepository } from './index'

const repository: Repository = {
  id: 'b4908e35-8a57-4c13-9366-489ec59071fe', owner: 'fuze', name: 'workspace',
  canonicalUrl: 'https://github.com/fuze/workspace', defaultBranch: 'main',
  kind: 'application', enabled: true, includeGlobs: [], excludeGlobs: [],
  jiraProjects: [], jiraBindings: [], lastScanStatus: 'never',
}
const roots: string[] = []
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'fq-workspace-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

const manifests = {
  npm: { 'package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*', 'packages/*'] }) },
  pnpm: { 'package.json': '{"name":"root"}', 'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n' },
  yarn: { 'package.json': JSON.stringify({ name: 'root', packageManager: 'yarn@4.6.0', workspaces: ['apps/*', 'packages/*'] }), '.yarnrc.yml': 'nodeLinker: node-modules\n' },
  nx: { 'package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*', 'packages/*'] }), 'nx.json': '{"namedInputs":{"default":["{projectRoot}/**/*"]}}', 'apps/web/project.json': '{"name":"web","sourceRoot":"apps/web/src"}' },
}

describe('workspace fidelity (FQ-149)', () => {
  it.each(Object.entries(manifests))('preserves package ownership and stable identities in %s fixtures', async (_name, manifest) => {
    const root = await fixture({
      ...manifest,
      'apps/web/package.json': '{"name":"@fuze/web"}',
      'packages/design/package.json': '{"name":"@fuze/design"}',
      'apps/web/src/UserPage.tsx': `export function UserPage() { return <div>Users</div> }\nexport const router = createBrowserRouter([{ path: '/users', element: <UserPage/> }])`,
      'packages/design/src/Button.tsx': 'export function Button() { return <button>Save</button> }',
    })
    const first = await scanRepository(repository, root, { sourceRevision: 'a'.repeat(40) })
    expect(first.surfaces.map(surface => [surface.packageName, surface.name]).sort()).toEqual([
      ['@fuze/design', 'Button'], ['@fuze/web', '/users'], ['@fuze/web', 'UserPage'],
    ])
    expect(first.scanDetails).toMatchObject({ sourceRevision: 'a'.repeat(40), scannerVersion: SCANNER_VERSION, partial: false, counts: { frontendSurfaces: 3, diagnostics: 0 } })
    expect(first.diagnostics).toEqual([])
    expect(first.scanDetails.candidates.filter(candidate => candidate.kind === 'package')).toHaveLength(3)
    const repeat = await scanRepository(repository, root, { sourceRevision: 'a'.repeat(40) })
    expect(repeat.surfaces).toEqual(first.surfaces)
    expect(repeat.scanDetails.catalogRevision).toEqual(first.scanDetails.catalogRevision)
    await writeFile(join(root, 'apps/web/src/UserPage.tsx'), `export function UserPage() { return <div>Updated users</div> }\nexport const router = createBrowserRouter([{ path: '/users', element: <UserPage/> }])`)
    const updated = await scanRepository(repository, root, { sourceRevision: 'b'.repeat(40) })
    expect(updated.surfaces.map(surface => surface.id).sort()).toEqual(first.surfaces.map(surface => surface.id).sort())
    expect(updated.scanDetails.sourceRevision).toBe('b'.repeat(40))
    expect(updated.scanDetails.catalogRevision).not.toBe(first.scanDetails.catalogRevision)
  })

  it('reports invalid manifests and preserves the inventory from valid packages', async () => {
    const root = await fixture({ 'package.json': '{"name":"root"}', 'apps/broken/package.json': '{', 'apps/web/package.json': '{"name":"web"}', 'apps/web/src/Page.tsx': 'export function Page() { return <div/> }' })
    const result = await scanRepository(repository, root)
    expect(result.surfaces.map(surface => surface.name)).toEqual(['Page'])
    expect(result.diagnostics).toEqual([expect.objectContaining({ sourcePath: 'apps/broken/package.json', code: 'invalid-package-manifest', severity: 'error' })])
    expect(result.scanDetails.partial).toBe(true)
  })

  it('returns an empty inventory for an empty repository', async () => {
    const result = await scanRepository(repository, await fixture({}))
    expect(result.surfaces).toEqual([])
    expect(result.scanDetails).toMatchObject({ partial: false, counts: { frontendSurfaces: 0, diagnostics: 0 } })
  })

  it('honors explicit exclusions without changing retained surface identities', async () => {
    const root = await fixture({ 'package.json': '{"name":"web"}', 'src/Page.tsx': 'export function Page() { return <div/> }', 'src/ignored/Other.tsx': 'export function Other() { return <div/> }' })
    const full = await scanRepository(repository, root)
    const excluded = await scanRepository({ ...repository, excludeGlobs: ['src/ignored/**'] }, root)
    expect(excluded.surfaces).toEqual(full.surfaces.filter(surface => surface.name === 'Page'))
  })

  it('does not include linked external source files or linked packages', async () => {
    const outside = await fixture({ 'package.json': '{"name":"external"}', 'src/ExternalPage.tsx': `export function ExternalPage() { return <div/> }\nexport const route = { path: '/external' }` })
    const root = await fixture({ 'package.json': '{"name":"web"}', 'src/Page.tsx': 'export function Page() { return <div/> }' })
    await symlink(join(outside, 'src/ExternalPage.tsx'), join(root, 'src/LinkedPage.tsx'))
    await symlink(outside, join(root, 'linked-package'), 'dir')
    const result = await scanRepository(repository, root)
    expect(result.surfaces.map(surface => surface.name)).toEqual(['Page'])
    expect(result.scanDetails.candidates.filter(candidate => candidate.kind === 'package').map(candidate => candidate.sourcePath)).toEqual(['package.json'])
  })

  // Expected failures document unmet parent-story requirements. Convert to ordinary
  // tests as FQ-144 replaces heuristic frontend discovery; they are not acceptance passes.
  it.fails('does not count comments, navigation links, and uppercase data as authoritative surfaces', async () => {
    const root = await fixture({ 'package.json': '{"name":"web"}', 'src/Page.tsx': `// export function FakePage() {}\n// const route = { path: '/comment' }\nexport const SETTINGS = { enabled: true }\nexport function Page() { return <Link to='/navigation'>Next</Link> }` })
    const result = await scanRepository(repository, root)
    expect(result.surfaces.map(surface => surface.name)).toEqual(['Page'])
  })

  it.fails('resolves nested relative React Router paths to their full route identity', async () => {
    const root = await fixture({ 'package.json': '{"name":"web"}', 'src/routes.tsx': `export const router = createBrowserRouter([{ path: '/users', children: [{ path: ':id', element: <div/> }] }])` })
    const result = await scanRepository(repository, root)
    expect(result.surfaces.map(surface => surface.routePath).sort()).toEqual(['/users', '/users/:id'])
  })

  it.fails('keeps distinct same-name components in the same package', async () => {
    const root = await fixture({ 'package.json': '{"name":"web"}', 'src/left/Button.tsx': 'export function Button() { return <button>Left</button> }', 'src/right/Button.tsx': 'export function Button() { return <button>Right</button> }' })
    const result = await scanRepository(repository, root)
    expect(result.surfaces).toHaveLength(2)
    expect(new Set(result.surfaces.map(surface => surface.id)).size).toBe(2)
  })

  it.fails('does not infer component states from comments', async () => {
    const root = await fixture({ 'package.json': '{"name":"web"}', 'src/Page.tsx': '// loading error empty state forbidden success\nexport function Page() { return <div/> }' })
    const result = await scanRepository(repository, root)
    expect(result.surfaces[0].states).toEqual(['default'])
  })
})
