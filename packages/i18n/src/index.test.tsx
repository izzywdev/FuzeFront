import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { I18nProvider, useI18n, directionFor, useT } from './index'

const messages = {
  en: { hello: 'Hello', greet: 'Hi {name}' },
  he: { hello: 'שלום', greet: 'שלום {name}' },
}

function Probe() {
  const { language, dir, setLanguage, t } = useI18n()
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="dir">{dir}</span>
      <span data-testid="hello">{t('hello')}</span>
      <span data-testid="greet">{t('greet', { name: 'Dana' })}</span>
      <span data-testid="missing">{t('nope')}</span>
      <button onClick={() => setLanguage('he')}>he</button>
    </div>
  )
}

describe('directionFor', () => {
  it('maps en -> ltr and he -> rtl', () => {
    expect(directionFor('en')).toBe('ltr')
    expect(directionFor('he')).toBe('rtl')
  })
})

describe('I18nProvider / useI18n', () => {
  it('translates, interpolates, and falls back to the key', () => {
    render(
      <I18nProvider language="en" messages={messages}>
        <Probe />
      </I18nProvider>
    )
    expect(screen.getByTestId('lang').textContent).toBe('en')
    expect(screen.getByTestId('dir').textContent).toBe('ltr')
    expect(screen.getByTestId('hello').textContent).toBe('Hello')
    expect(screen.getByTestId('greet').textContent).toBe('Hi Dana')
    expect(screen.getByTestId('missing').textContent).toBe('nope')
  })

  it('flips direction + language to RTL when switched to he', () => {
    render(
      <I18nProvider language="en" messages={messages}>
        <Probe />
      </I18nProvider>
    )
    act(() => {
      screen.getByText('he').click()
    })
    expect(screen.getByTestId('lang').textContent).toBe('he')
    expect(screen.getByTestId('dir').textContent).toBe('rtl')
    expect(screen.getByTestId('hello').textContent).toBe('שלום')
  })

  it('useT returns a working translate function', () => {
    function TOnly() {
      const t = useT()
      return <span data-testid="t">{t('hello')}</span>
    }
    render(
      <I18nProvider language="he" messages={messages}>
        <TOnly />
      </I18nProvider>
    )
    expect(screen.getByTestId('t').textContent).toBe('שלום')
  })

  it('throws when useI18n is used outside a provider', () => {
    function Bad() {
      useI18n()
      return null
    }
    expect(() => render(<Bad />)).toThrow(/I18nProvider/)
  })
})
