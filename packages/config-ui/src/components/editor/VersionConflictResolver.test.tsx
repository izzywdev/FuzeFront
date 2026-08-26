import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigI18nProvider } from '../../i18n/ConfigI18nProvider'
import { VersionConflictResolver } from './VersionConflictResolver'

const conflicts = [
  { key: 'notifications.digest.frequency', theirValue: 'weekly', yourValue: 'daily', changedBy: 'changed by j.okafor · 2 min ago' },
  { key: 'notifications.retry.backoff', theirValue: 'PT10M', yourValue: 'PT5M', changedBy: 'changed at portal Acme Portal — inherited change' },
]

describe('<VersionConflictResolver>', () => {
  it('renders one row per conflicting key with independently selectable Theirs/Yours', () => {
    render(
      <ConfigI18nProvider>
        <VersionConflictResolver
          loadedVersion="v-8814"
          currentVersion="v-8817"
          conflicts={conflicts}
          picks={{ 'notifications.digest.frequency': 'yours', 'notifications.retry.backoff': 'theirs' }}
          onPickChange={vi.fn()}
          onDiscardMine={vi.fn()}
          onSaveMerged={vi.fn()}
        />
      </ConfigI18nProvider>
    )
    expect(screen.getAllByRole('row')).toHaveLength(3) // header + 2 conflicts
    expect(screen.getAllByRole('button', { name: 'Theirs' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Yours' })).toHaveLength(2)
  })

  it('never renders a blind Retry or Force-save/Overwrite affordance', () => {
    render(
      <ConfigI18nProvider>
        <VersionConflictResolver
          loadedVersion="v-8814"
          currentVersion="v-8817"
          conflicts={conflicts}
          picks={{}}
          onPickChange={vi.fn()}
          onDiscardMine={vi.fn()}
          onSaveMerged={vi.fn()}
        />
      </ConfigI18nProvider>
    )
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /force/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /overwrite/i })).not.toBeInTheDocument()
  })

  it('calls onPickChange with the chosen side for the right key', async () => {
    const user = userEvent.setup()
    const onPickChange = vi.fn()
    render(
      <ConfigI18nProvider>
        <VersionConflictResolver
          loadedVersion="v-8814"
          currentVersion="v-8817"
          conflicts={conflicts}
          picks={{}}
          onPickChange={onPickChange}
          onDiscardMine={vi.fn()}
          onSaveMerged={vi.fn()}
        />
      </ConfigI18nProvider>
    )
    const row = screen.getByText('notifications.digest.frequency').closest('tr')!
    const { getByRole } = within(row)
    await user.click(getByRole('button', { name: 'Theirs' }))
    expect(onPickChange).toHaveBeenCalledWith('notifications.digest.frequency', 'theirs')
  })

  it('states plainly that nothing was saved', () => {
    render(
      <ConfigI18nProvider>
        <VersionConflictResolver
          loadedVersion="v-8814"
          currentVersion="v-8817"
          conflicts={conflicts}
          picks={{}}
          onPickChange={vi.fn()}
          onDiscardMine={vi.fn()}
          onSaveMerged={vi.fn()}
        />
      </ConfigI18nProvider>
    )
    expect(screen.getAllByText(/nothing was saved/i).length).toBeGreaterThan(0)
  })

  it('the merge-save action targets the fresh currentVersion, not the stale loadedVersion', async () => {
    const user = userEvent.setup()
    const onSaveMerged = vi.fn()
    render(
      <ConfigI18nProvider>
        <VersionConflictResolver
          loadedVersion="v-8814"
          currentVersion="v-8817"
          conflicts={conflicts}
          picks={{}}
          onPickChange={vi.fn()}
          onDiscardMine={vi.fn()}
          onSaveMerged={onSaveMerged}
        />
      </ConfigI18nProvider>
    )
    const button = screen.getByRole('button', { name: /save merged/i })
    expect(button).toHaveTextContent('v-8817')
    await user.click(button)
    expect(onSaveMerged).toHaveBeenCalledTimes(1)
  })
})
