import { describe, expect, it } from 'vitest'
import { currentQualityArtifactsSql, revisionQualityArtifactsSql } from './store'

describe('quality artifact persistence contract', () => {
  it('loads every artifact from only the repository current scan revision', () => {
    expect(currentQualityArtifactsSql).toContain('revision=(SELECT last_scan_revision')
    expect(currentQualityArtifactsSql).not.toContain('DISTINCT ON')
    expect(currentQualityArtifactsSql).toContain('ORDER BY kind, source_path, title, id')
  })

  it('loads event-time analysis artifacts from one exact revision', () => {
    expect(revisionQualityArtifactsSql).toContain('repository_id=$1 AND revision=$2')
    expect(revisionQualityArtifactsSql).not.toContain('last_scan_revision')
    expect(revisionQualityArtifactsSql).toContain('ORDER BY kind, source_path, title, id')
  })
})
