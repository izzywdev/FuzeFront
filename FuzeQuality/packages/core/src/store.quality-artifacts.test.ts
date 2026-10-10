import { describe, expect, it } from 'vitest'
import { currentQualityArtifactsSql } from './store'

describe('quality artifact persistence contract', () => {
  it('loads every artifact from only the repository current scan revision', () => {
    expect(currentQualityArtifactsSql).toContain('revision=(SELECT last_scan_revision')
    expect(currentQualityArtifactsSql).not.toContain('DISTINCT ON')
    expect(currentQualityArtifactsSql).toContain('ORDER BY kind, source_path, title, id')
  })
})
