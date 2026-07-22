import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { scanRepository } from '@fuzequality/scanner'

const root = resolve(process.argv[2] ?? '..')
const name = process.argv[3] ?? root.split(/[\\/]/).at(-1) ?? 'repository'
const result = await scanRepository(
  {
    id: randomUUID(),
    owner: 'local',
    name,
    canonicalUrl: `https://github.com/local/${name}`,
    defaultBranch: 'main',
    kind: 'mixed',
    enabled: true,
    includeGlobs: [],
    excludeGlobs: [],
    jiraProjects: [],
    lastScanStatus: 'running',
  },
  root
)

console.log(
  JSON.stringify(
    {
      revision: result.revision,
      operations: result.operations.length,
      surfaces: result.surfaces.length,
      tests: result.tests.length,
      expectations: result.expectations.length,
      findings: result.findings.length,
    },
    null,
    2
  )
)
