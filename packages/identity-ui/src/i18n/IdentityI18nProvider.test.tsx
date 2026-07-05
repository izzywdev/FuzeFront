import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IdentityI18nProvider, useIdentityI18n } from './IdentityI18nProvider'

function Probe() {
  const { locale, dir, messages, t } = useIdentityI18n()
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="dir">{dir}</span>
      <span data-testid="members">{messages.members.title}</span>
      <span data-testid="interp">{t(messages.invitations.invitedCount, { count: 3 })}</span>
    </div>
  )
}

describe('IdentityI18nProvider', () => {
  it('defaults to English ltr', () => {
    render(
      <IdentityI18nProvider>
        <Probe />
      </IdentityI18nProvider>
    )
    expect(screen.getByTestId('locale').textContent).toBe('en')
    expect(screen.getByTestId('dir').textContent).toBe('ltr')
    expect(screen.getByTestId('members').textContent).toBe('Members')
  })

  it('renders Hebrew with rtl direction', () => {
    render(
      <IdentityI18nProvider locale="he">
        <Probe />
      </IdentityI18nProvider>
    )
    expect(screen.getByTestId('dir').textContent).toBe('rtl')
    expect(screen.getByTestId('members').textContent).toBe('חברים')
  })

  it('interpolates {count} placeholders', () => {
    render(
      <IdentityI18nProvider>
        <Probe />
      </IdentityI18nProvider>
    )
    expect(screen.getByTestId('interp').textContent).toContain('3')
  })

  it('provides an English fallback when used outside a provider', () => {
    render(<Probe />)
    expect(screen.getByTestId('locale').textContent).toBe('en')
  })
})
