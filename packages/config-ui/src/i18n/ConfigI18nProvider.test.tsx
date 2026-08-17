import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConfigI18nProvider, useConfigI18n } from './ConfigI18nProvider'

function Probe() {
  const { locale, dir, messages, t } = useConfigI18n()
  return (
    <div data-locale={locale} dir={dir}>
      <span>{t(messages.editor.provenanceSet, { scope: 'org Acme Corp' })}</span>
    </div>
  )
}

describe('<ConfigI18nProvider>', () => {
  it('defaults to English, ltr', () => {
    render(
      <ConfigI18nProvider>
        <Probe />
      </ConfigI18nProvider>
    )
    expect(screen.getByText('Set here · org Acme Corp')).toBeInTheDocument()
    expect(document.querySelector('[dir="ltr"]')).not.toBeNull()
  })

  it('switches to Hebrew and rtl when locale="he"', () => {
    render(
      <ConfigI18nProvider locale="he">
        <Probe />
      </ConfigI18nProvider>
    )
    expect(document.querySelector('[dir="rtl"]')).not.toBeNull()
    expect(screen.getByText(/הוגדר כאן/)).toBeInTheDocument()
  })

  it('falls back to English messages when used with no provider at all', () => {
    render(<Probe />)
    expect(screen.getByText('Set here · org Acme Corp')).toBeInTheDocument()
  })
})
