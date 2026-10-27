// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QualityAction, QualityDetailModal, QualityIconAction } from './primitives'

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

  it('uses the shared accessible modal for app-specific detail surfaces', () => {
    render(
      <QualityDetailModal open title="Flow inspector">
        <p>Flow evidence</p>
      </QualityDetailModal>
    )

    expect(screen.getByRole('dialog', { name: 'Flow inspector' })).toBeInTheDocument()
    expect(screen.getByText('Flow evidence')).toBeVisible()
  })
})
