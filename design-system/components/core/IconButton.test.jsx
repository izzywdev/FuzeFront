import React, { createRef } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IconButton } from './IconButton.jsx'

describe('IconButton', () => {
  it('forwards its native button ref so overlays can restore focus', () => {
    const ref = createRef()
    render(
      <IconButton ref={ref} label="Close">
        ×
      </IconButton>
    )

    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    expect(ref.current).toHaveAttribute('aria-label', 'Close')
  })
})
