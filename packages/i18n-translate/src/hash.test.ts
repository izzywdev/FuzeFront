import { describe, it, expect } from 'vitest'
import { sourceHash, emptyMeta, META_SUFFIX } from './hash'

describe('sourceHash', () => {
  it('is stable for identical input', () => {
    expect(sourceHash('Welcome back, {{name}}.')).toBe(
      sourceHash('Welcome back, {{name}}.')
    )
  })

  it('changes when the source changes', () => {
    expect(sourceHash('Dashboard')).not.toBe(sourceHash('Dashboards'))
  })

  it('emptyMeta has an empty hash map', () => {
    expect(emptyMeta()).toEqual({ hashes: {} })
  })

  it('exposes a sidecar suffix', () => {
    expect(META_SUFFIX).toBe('.meta.json')
  })
})
