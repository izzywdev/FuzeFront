import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextSwitchErrorNotice } from './ContextSwitchErrorNotice'

describe('ContextSwitchErrorNotice', () => {
  it('renders the fail state with a retry action', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    render(<ContextSwitchErrorNotice onRetry={onRetry} />)
    const notice = screen.getByRole('alert')
    expect(notice).toHaveAttribute('data-state', 'error')
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
