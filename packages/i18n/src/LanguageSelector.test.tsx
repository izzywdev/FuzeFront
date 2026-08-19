import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from './I18nProvider'
import { LanguageSelector } from './LanguageSelector'
import { resources } from './test/fixtures'
import { LANGUAGE_STORAGE_KEY } from './storage'

const TEST_LANGS = [
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' as const },
  { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr' as const },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl' as const },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', dir: 'rtl' as const },
]

function renderSelector(props = {}) {
  return render(
    <I18nProvider resources={resources}>
      <LanguageSelector languages={TEST_LANGS} {...props} />
    </I18nProvider>
  )
}

describe('LanguageSelector', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('dir')
    document.documentElement.removeAttribute('lang')
  })

  it('renders an accessible labeled combobox with native language names', async () => {
    renderSelector()
    const select = await screen.findByRole('combobox', { name: 'Language' })
    expect(select).toBeInTheDocument()
    // Endonyms, not English names.
    expect(within(select).getByRole('option', { name: 'Español' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'العربية' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'עברית' })).toBeInTheDocument()
  })

  it('associates the label with the control via htmlFor/id', async () => {
    renderSelector()
    const select = (await screen.findByRole('combobox', {
      name: 'Language',
    })) as HTMLSelectElement
    const label = screen.getByText('Language')
    expect(label).toHaveAttribute('for', select.id)
    expect(select.id).toBeTruthy()
  })

  it('supports a visually-hidden label that stays in the a11y tree', async () => {
    renderSelector({ hideLabel: true })
    // Still findable by accessible name even though visually hidden.
    expect(
      await screen.findByRole('combobox', { name: 'Language' })
    ).toBeInTheDocument()
  })

  it('uses only design-system token variables for styling (no hard-coded colors)', async () => {
    const { container } = renderSelector()
    await screen.findByRole('combobox', { name: 'Language' })
    const html = container.innerHTML
    // No raw hex / rgb colors or px spacing leaked into inline styles.
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
    expect(html).not.toMatch(/rgb\(/)
    // Tokens are present.
    expect(html).toMatch(/var\(--bg-secondary\)/)
    expect(html).toMatch(/var\(--accent-color\)|var\(--space-3\)/)
  })

  it('changing to Arabic flips document dir to rtl and translates the label', async () => {
    const user = userEvent.setup()
    renderSelector()
    const select = await screen.findByRole('combobox', { name: 'Language' })
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')

    await user.selectOptions(select, 'ar')

    await waitFor(() =>
      expect(document.documentElement.getAttribute('dir')).toBe('rtl')
    )
    expect(document.documentElement.getAttribute('lang')).toBe('ar')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ar')
    // Label re-renders in Arabic.
    expect(await screen.findByText('اللغة')).toBeInTheDocument()
  })

  it('changing to Hebrew (RTL) then back to English (LTR) flips dir both ways', async () => {
    const user = userEvent.setup()
    renderSelector()
    const select = await screen.findByRole('combobox', { name: 'Language' })

    await user.selectOptions(select, 'he')
    await waitFor(() =>
      expect(document.documentElement.getAttribute('dir')).toBe('rtl')
    )

    const selectAfter = await screen.findByRole('combobox')
    await user.selectOptions(selectAfter, 'en')
    await waitFor(() =>
      expect(document.documentElement.getAttribute('dir')).toBe('ltr')
    )
  })
})
