import React, { createContext, useContext, useMemo } from 'react'
import type { ConfigMessages } from './messages'
import { en } from './locales/en'
import { he } from './locales/he'

export type ConfigLocale = 'en' | 'he'

const LOCALES: Record<ConfigLocale, ConfigMessages> = { en, he }
const RTL_LOCALES = new Set<ConfigLocale>(['he'])

export interface ConfigI18nContextValue {
  locale: ConfigLocale
  dir: 'ltr' | 'rtl'
  /** Resolved messages for the active locale, with English fallback per key. */
  messages: ConfigMessages
  /** Interpolate `{name}`-style placeholders in a string. */
  t: (value: string, vars?: Record<string, string | number>) => string
}

const ConfigI18nContext = createContext<ConfigI18nContextValue | null>(null)

/** Deep-merge a partial/locale object over the English base so missing keys fall back. */
function withFallback(locale: ConfigMessages): ConfigMessages {
  return mergeDeep(
    en as unknown as Record<string, unknown>,
    locale as unknown as Record<string, unknown>
  ) as unknown as ConfigMessages
}

function mergeDeep(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(over)) {
    const ov = over[key]
    const bv = base[key]
    if (ov && typeof ov === 'object' && !Array.isArray(ov) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[key] = mergeDeep(bv as Record<string, unknown>, ov as Record<string, unknown>)
    } else if (ov !== undefined && ov !== '') {
      out[key] = ov
    }
  }
  return out
}

function interpolate(value: string, vars?: Record<string, string | number>): string {
  if (!vars) return value
  return value.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match))
}

export interface ConfigI18nProviderProps {
  locale?: ConfigLocale
  children: React.ReactNode
}

export function ConfigI18nProvider({ locale = 'en', children }: ConfigI18nProviderProps) {
  const value = useMemo<ConfigI18nContextValue>(() => {
    const base = LOCALES[locale] ?? en
    const messages = withFallback(base)
    return {
      locale,
      dir: RTL_LOCALES.has(locale) ? 'rtl' : 'ltr',
      messages,
      t: interpolate,
    }
  }, [locale])

  return <ConfigI18nContext.Provider value={value}>{children}</ConfigI18nContext.Provider>
}

export function useConfigI18n(): ConfigI18nContextValue {
  const ctx = useContext(ConfigI18nContext)
  if (ctx) return ctx
  // Fallback when used outside a provider — English, ltr.
  return {
    locale: 'en',
    dir: 'ltr',
    messages: en,
    t: interpolate,
  }
}
