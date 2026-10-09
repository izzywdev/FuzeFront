// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QualityAction, QualityIconAction } from './primitives'

describe('FuzeQuality design-system adapters', () => {
  it('maps product action intent onto the shared button primitive', () => {
    render(<QualityAction intent="secondary">Scan now</QualityAction>)

    expect(
      screen.getByRole('button', { name: 'Scan now' }).style.background
    ).toBe('var(--bg-quaternary)')
  })

  it('keeps icon controls accessible through the shared primitive', () => {
    render(<QualityIconAction label="Close repository form">×</QualityIconAction>)

    expect(
      screen
        .getByRole('button', { name: 'Close repository form' })
        .getAttribute('title')
    ).toBe('Close repository form')
  })
})
