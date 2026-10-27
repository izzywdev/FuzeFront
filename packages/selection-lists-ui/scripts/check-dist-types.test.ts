import { findUndeclaredTypeReferences, packageNameOf } from './check-dist-types.mjs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

type Finding = { file: string; specifier: string; packageName: string }
const find = findUndeclaredTypeReferences as (
  dir: string,
  manifest: Record<string, unknown>,
) => Finding[]
const nameOf = packageNameOf as (specifier: string) => string

let dist: string

function declaration(relative: string, body: string) {
  const file = join(dist, relative)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, body)
}

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'dist-types-'))
})
afterEach(() => rmSync(dist, { recursive: true, force: true }))

describe('check-dist-types', () => {
  it('derives the package name from deep and scoped specifiers', () => {
    expect(nameOf('react')).toBe('react')
    expect(nameOf('react/jsx-runtime')).toBe('react')
    expect(nameOf('@fuzeone/selection-list-client')).toBe('@fuzeone/selection-list-client')
    expect(nameOf('@fuzefront/design-system/tokens')).toBe('@fuzefront/design-system')
  })

  it('flags a type import of a package the manifest does not declare', () => {
    declaration(
      'shared-lists/core/types.d.ts',
      "import type { SelectionList } from '@fuzeone/selection-list-client';\nexport type SharedList = SelectionList;\n",
    )
    const found = find(dist, { peerDependencies: { react: '^19.0.0' } })
    expect(found).toHaveLength(1)
    expect(found[0].packageName).toBe('@fuzeone/selection-list-client')
    expect(found[0].file).toMatch(/types\.d\.ts$/)
  })

  it('passes once the package is a peerDependency or a dependency', () => {
    declaration('types.d.ts', "export type { SelectionList } from '@fuzeone/selection-list-client';\n")
    expect(
      find(dist, { peerDependencies: { '@fuzeone/selection-list-client': '^2.1.1' } }),
    ).toEqual([])
    expect(find(dist, { dependencies: { '@fuzeone/selection-list-client': '^2.1.1' } })).toEqual([])
  })

  it('does not count devDependencies as declared (they are not installed for consumers)', () => {
    declaration('types.d.ts', "import type { A } from '@fuzeone/selection-list-client';\n")
    expect(
      find(dist, { devDependencies: { '@fuzeone/selection-list-client': 'file:../../x' } }),
    ).toHaveLength(1)
  })

  it('ignores relative specifiers', () => {
    declaration('index.d.ts', "export * from './types';\nimport type { B } from '../b';\n")
    expect(find(dist, {})).toEqual([])
  })

  it('finds every reference form: bare import, dynamic import type, triple-slash reference', () => {
    declaration('a.d.ts', "import 'side-effect-pkg';\n")
    declaration('b.d.ts', 'export type T = import("dynamic-pkg").T;\n')
    declaration('c.d.ts', '/// <reference types="ref-pkg" />\n')
    declaration('d.d.mts', "export * from 'star-pkg';\n")
    const names = find(dist, {}).map((f) => f.packageName).sort()
    expect(names).toEqual(['dynamic-pkg', 'ref-pkg', 'side-effect-pkg', 'star-pkg'])
  })

  it('reports a package once per file, even when imported several times', () => {
    declaration(
      'types.d.ts',
      "import type { A } from 'x-pkg';\nimport type { B } from 'x-pkg/deep';\nexport type C = import('x-pkg').C;\n",
    )
    expect(find(dist, {})).toHaveLength(1)
  })

  it('only scans declaration files', () => {
    writeFileSync(join(dist, 'index.js'), "import x from 'runtime-only';\n")
    expect(find(dist, {})).toEqual([])
  })
})
