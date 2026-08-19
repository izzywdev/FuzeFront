import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessLostNotice } from './AccessLostNotice'

describe('AccessLostNotice', () => {
  it('renders the fail-closed 403 ACCESS_LOST state, never a sign-in redirect', async () => {
    const onGoPersonal = vi.fn()
    const user = userEvent.setup()
    render(<AccessLostNotice onGoPersonal={onGoPersonal} />)
    const notice = screen.getByRole('alert')
    expect(notice).toHaveAttribute('data-http', '403')
    expect(notice).toHaveAttribute('data-error-code', 'ACCESS_LOST')
    await user.click(screen.getByRole('button', { name: /go to personal/i }))
    expect(onGoPersonal).toHaveBeenCalledTimes(1)
  })
})
