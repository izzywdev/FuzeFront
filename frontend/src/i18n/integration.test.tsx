import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider, LanguageSelector, useT } from '@fuzefront/i18n'
import { resources, bundledLanguages } from './resources'

/**
 * End-to-end proof that the container wires @fuzefront/i18n correctly:
 *  - the repo-root locales/ tree is bundled into the i18next Resource shape,
 *  - migrated UI strings resolve via useT() flat dotted keys,
 *  - the LanguageSelector flips <html dir> through the centralized manager.
 */

function Probe() {
  const { t } = useT()
  // Mirrors the migrated SidePanel/TopBar usage (flat dotted keys, common ns).
  return (
    <div>
      <span data-testid="dashboard">{t('nav.dashboard')}</span>
      <span data-testid="theme">{t('theme.switchToDark')}</span>
    </div>
  )
}

describe('frontend i18n integration', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('dir')
    document.documentElement.removeAttribute('lang')
  })

  it('bundles the repo-root locales (en + RTL he/ar) into the resource map', () => {
    expect(bundledLanguages).toContain('en')
    expect(bundledLanguages).toContain('he')
    expect(bundledLanguages).toContain('ar')
    expect((resources.en as Record<string, unknown>).common).toBeDefined()
  })

  it('resolves migrated flat-dotted UI keys through useT (English)', async () => {
    render(
      <I18nProvider resources={resources}>
        <Probe />
      </I18nProvider>
    )
    await waitFor(() =>
      expect(screen.getByTestId('dashboard')).toHaveTextContent('Dashboard')
    )
    expect(screen.getByTestId('theme')).toHaveTextContent('Switch to dark mode')
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')
  })

  it('LanguageSelector flips to Hebrew (RTL) and translates bundled strings', async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider resources={resources}>
        <LanguageSelector hideLabel />
        <Probe />
      </I18nProvider>
    )
    const select = await screen.findByRole('combobox', { name: 'Language' })
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')

    await user.selectOptions(select, 'he')

    await waitFor(() =>
      expect(document.documentElement.getAttribute('dir')).toBe('rtl')
    )
    expect(document.documentElement.getAttribute('lang')).toBe('he')
    // Bundled Hebrew string renders for a migrated key.
    await waitFor(() =>
      expect(screen.getByTestId('dashboard')).toHaveTextContent('לוח בקרה')
    )
  })

  it('flips to Arabic (RTL) then back to English (LTR)', async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider resources={resources}>
        <LanguageSelector hideLabel />
        <Probe />
      </I18nProvider>
    )
    const select = await screen.findByRole('combobox', { name: 'Language' })

    await user.selectOptions(select, 'ar')
    await waitFor(() =>
      expect(document.documentElement.getAttribute('dir')).toBe('rtl')
    )
    expect(document.documentElement.getAttribute('lang')).toBe('ar')

    const back = await screen.findByRole('combobox')
    await user.selectOptions(back, 'en')
    await waitFor(() =>
      expect(document.documentElement.getAttribute('dir')).toBe('ltr')
    )
    expect(screen.getByTestId('dashboard')).toHaveTextContent('Dashboard')
  })
})
