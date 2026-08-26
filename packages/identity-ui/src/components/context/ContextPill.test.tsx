import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextPill } from './ContextPill'

describe('ContextPill', () => {
  it('renders the active label and data-context hooks', () => {
    render(<ContextPill label="FuzeFront" context="org" onClick={vi.fn()} />)
    expect(screen.getByText('FuzeFront')).toBeInTheDocument()
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('data-context', 'org')
    expect(btn).toHaveAttribute('aria-haspopup', 'menu')
  })

  it('renders Personal for the personal context', () => {
    render(<ContextPill label="Personal" context="personal" onClick={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveAttribute('data-context', 'personal')
  })

  it('calls onClick and reflects aria-expanded when open', () => {
    const onClick = vi.fn()
    render(<ContextPill label="FuzeFront" context="org" open onClick={onClick} />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
