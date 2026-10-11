// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FlowInventoryFilters } from './flowInventoryFilters'

const repository = {
  id: 'repo-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://example.test/fuze/front', defaultBranch: 'main', kind: 'application' as const,
  includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true, lastScanStatus: 'complete' as const,
}

describe('FlowInventoryFilters', () => {
  it('exposes repository, review, revision, and LiteLLM provenance controls', () => {
    const onRepositoryIdChange = vi.fn()
    const onSourceChange = vi.fn()
    const onStatusChange = vi.fn()
    const onRevisionScopeChange = vi.fn()
    const onModelChange = vi.fn()
    const onPromptVersionChange = vi.fn()
    const onSchemaVersionChange = vi.fn()
    render(<FlowInventoryFilters
      repositories={[repository]}
      repositoryId=""
      source=""
      status=""
      revisionScope="all"
      model=""
      promptVersion=""
      schemaVersion=""
      onRepositoryIdChange={onRepositoryIdChange}
      onSourceChange={onSourceChange}
      onStatusChange={onStatusChange}
      onRevisionScopeChange={onRevisionScopeChange}
      onModelChange={onModelChange}
      onPromptVersionChange={onPromptVersionChange}
      onSchemaVersionChange={onSchemaVersionChange}
    />)

    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'repo-1' } })
    fireEvent.change(screen.getByLabelText('Origin'), { target: { value: 'litellm' } })
    fireEvent.change(screen.getByLabelText('Review state'), { target: { value: 'confirmed' } })
    fireEvent.change(screen.getByLabelText('Analysis revision'), { target: { value: 'current' } })
    fireEvent.change(screen.getByLabelText('Analysis model'), { target: { value: 'quality-analysis' } })
    fireEvent.change(screen.getByLabelText('Prompt version'), { target: { value: 'flow-v2' } })
    fireEvent.change(screen.getByLabelText('Schema version'), { target: { value: '2.0' } })

    expect(onRepositoryIdChange).toHaveBeenCalledWith('repo-1')
    expect(onSourceChange).toHaveBeenCalledWith('litellm')
    expect(onStatusChange).toHaveBeenCalledWith('confirmed')
    expect(onRevisionScopeChange).toHaveBeenCalledWith('current')
    expect(onModelChange).toHaveBeenCalledWith('quality-analysis')
    expect(onPromptVersionChange).toHaveBeenCalledWith('flow-v2')
    expect(onSchemaVersionChange).toHaveBeenCalledWith('2.0')
  })
})
