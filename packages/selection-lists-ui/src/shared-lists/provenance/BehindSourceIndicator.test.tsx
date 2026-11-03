import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BehindSourceIndicator } from './BehindSourceIndicator'
import type { BehindState } from './derive'

const renderIndicator = (state: BehindState, extra = {}) =>
  render(
    <BehindSourceIndicator
      state={state}
      copiedRevision={7}
      forkedOn="Sep 2, 2026"
      {...extra}
    />
  )

describe('BehindSourceIndicator (frame 07, every state)', () => {
  it('checking - a status spinner, nothing else', () => {
    const { container } = renderIndicator('checking')
    expect(container.querySelector('[data-behind-state="checking"]')).not.toBeNull()
    expect(screen.getByText('Checking the common list…')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('behind - informational, with no merge/sync control', () => {
    const { container } = renderIndicator('behind')
    expect(container.querySelector('[data-behind-state="behind"]')).not.toBeNull()
    expect(container).toHaveTextContent('The common list has changed since you forked.')
    expect(container).toHaveTextContent('nothing is merged automatically')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('up-to-date', () => {
    const { container } = renderIndicator('up-to-date')
    expect(container).toHaveTextContent('Same version as the common list (7).')
  })

  it('source-archived - retired, fork unaffected', () => {
    const { container } = renderIndicator('source-archived')
    expect(container).toHaveTextContent('The common list was retired (archived). Your fork is unaffected.')
  })

  it('source-gone - names the copy, no link, no alert', () => {
    const { container } = renderIndicator('source-gone')
    expect(container).toHaveTextContent('Your fork is unaffected. Copied version 7 on Sep 2, 2026.')
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('unknown - comparison unavailable', () => {
    const { container } = renderIndicator('unknown')
    expect(container).toHaveTextContent(
      'Copied version 7. Changes to the common list since then are not tracked here.'
    )
  })

  it('error - Retry runs the callback', async () => {
    const onRetry = vi.fn()
    renderIndicator('error', { onRetry })
    expect(screen.getByText("Couldn't check the common list.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('error without a callback has no Retry; compact Retry is touch-sized', () => {
    const { rerender } = renderIndicator('error')
    expect(screen.queryByRole('button')).toBeNull()
    rerender(
      <BehindSourceIndicator state="error" copiedRevision={7} forkedOn="x" onRetry={() => {}} compact />
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveStyle({
      minBlockSize: 'var(--touch-target)',
    })
  })

  it('isolates the revision numbers for bidi', () => {
    const { container } = renderIndicator('unknown')
    expect(container.querySelector('bdi')).toHaveStyle({ unicodeBidi: 'isolate' })
  })
})
