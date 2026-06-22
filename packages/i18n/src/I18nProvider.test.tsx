import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from './I18nProvider'
import { useT } from './useT'
import { resources } from './test/fixtures'
import { LANGUAGE_STORAGE_KEY } from './storage'

function Greeting() {
  const { t } = useT()
  return <p>{t('greeting.welcome', { name: 'Izzy' })}</p>
}

describe('I18nProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('dir')
    document.documentElement.removeAttribute('lang')
  })

  it('initializes i18next, renders translated + interpolated text in English', async () => {
    render(
      <I18nProvider resources={resources}>
        <Greeting />
      </I18nProvider>
    )
    await waitFor(() =>
      expect(screen.getByText('Welcome back, Izzy.')).toBeInTheDocument()
    )
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')
  })

  it('restores the saved language from storage on init', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'es')
    render(
      <I18nProvider resources={resources}>
        <Greeting />
      </I18nProvider>
    )
    await waitFor(() =>
      expect(
        screen.getByText('Bienvenido de nuevo, Izzy.')
      ).toBeInTheDocument()
    )
  })

  it('honors an explicit lng override and sets RTL direction for it', async () => {
    render(
      <I18nProvider resources={resources} lng="ar">
        <Greeting />
      </I18nProvider>
    )
    await waitFor(() =>
      expect(screen.getByText('مرحبًا بعودتك، Izzy.')).toBeInTheDocument()
    )
    expect(document.documentElement.getAttribute('dir')).toBe('rtl')
    expect(document.documentElement.getAttribute('lang')).toBe('ar')
  })

  it('renders the fallback until initialized', () => {
    const { container } = render(
      <I18nProvider resources={resources} fallback={<span>loading…</span>}>
        <Greeting />
      </I18nProvider>
    )
    // Synchronously (before the init promise resolves) the fallback shows.
    expect(container.textContent).toContain('loading…')
  })
})
