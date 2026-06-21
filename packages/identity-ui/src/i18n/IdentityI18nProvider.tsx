import React, { createContext, useContext, useMemo } from 'react'
import type { IdentityMessages } from './messages'
import { en } from './locales/en'
import { he } from './locales/he'

export type IdentityLocale = 'en' | 'he'

const LOCALES: Record<IdentityLocale, IdentityMessages> = { en, he }
const RTL_LOCALES = new Set<IdentityLocale>(['he'])

export interface IdentityI18nContextValue {
  locale: IdentityLocale
  dir: 'ltr' | 'rtl'
  /** Resolved messages for the active locale, with English fallback per key. */
  messages: IdentityMessages
  /** Interpolate `{count}`-style placeholders in a string. */
  t: (value: string, vars?: Record<string, string | number>) => string
}

const IdentityI18nContext = createContext<IdentityI18nContextValue | null>(null)

/** Deep-merge a partial/locale object over the English base so missing keys fall back. */
function withFallback(locale: IdentityMessages): IdentityMessages {
  // en is the complete base; locales are fully typed so this is identity in practice,
  // but it guards against an incomplete locale object at runtime.
  return mergeDeep(en as unknown as Record<string, unknown>, locale as unknown as Record<string, unknown>) as unknown as IdentityMessages
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
  return value.replace(/\{(\w+)\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match
  )
}

export interface IdentityI18nProviderProps {
  locale?: IdentityLocale
  children: React.ReactNode
}

export function IdentityI18nProvider({ locale = 'en', children }: IdentityI18nProviderProps) {
  const value = useMemo<IdentityI18nContextValue>(() => {
    const base = LOCALES[locale] ?? en
    const messages = withFallback(base)
    return {
      locale,
      dir: RTL_LOCALES.has(locale) ? 'rtl' : 'ltr',
      messages,
      t: interpolate,
    }
  }, [locale])

  return <IdentityI18nContext.Provider value={value}>{children}</IdentityI18nContext.Provider>
}

export function useIdentityI18n(): IdentityI18nContextValue {
  const ctx = useContext(IdentityI18nContext)
  if (ctx) return ctx
  // Fallback when used outside a provider — English, ltr.
  return {
    locale: 'en',
    dir: 'ltr',
    messages: en,
    t: interpolate,
  }
}
