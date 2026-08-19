import React, { createContext, useContext, useMemo } from 'react'
import type { AccountSecurityMessages } from './messages'
import { en } from './locales/en'
import { he } from './locales/he'

export type AccountSecurityLocale = 'en' | 'he'

const LOCALES: Record<AccountSecurityLocale, AccountSecurityMessages> = { en, he }
const RTL_LOCALES = new Set<AccountSecurityLocale>(['he'])

export interface AccountSecurityI18nContextValue {
  locale: AccountSecurityLocale
  dir: 'ltr' | 'rtl'
  messages: AccountSecurityMessages
  /** Interpolate `{name}`-style placeholders. */
  t: (value: string, vars?: Record<string, string | number>) => string
}

const Ctx = createContext<AccountSecurityI18nContextValue | null>(null)

function mergeDeep(
  base: Record<string, unknown>,
  over: Record<string, unknown>
): Record<string, unknown> {
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

function withFallback(locale: AccountSecurityMessages): AccountSecurityMessages {
  return mergeDeep(
    en as unknown as Record<string, unknown>,
    locale as unknown as Record<string, unknown>
  ) as unknown as AccountSecurityMessages
}

function interpolate(value: string, vars?: Record<string, string | number>): string {
  if (!vars) return value
  return value.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

export interface AccountSecurityI18nProviderProps {
  locale?: AccountSecurityLocale
  children: React.ReactNode
}

export function AccountSecurityI18nProvider({
  locale = 'en',
  children,
}: AccountSecurityI18nProviderProps) {
  const value = useMemo<AccountSecurityI18nContextValue>(() => {
    const base = LOCALES[locale] ?? en
    return {
      locale,
      dir: RTL_LOCALES.has(locale) ? 'rtl' : 'ltr',
      messages: withFallback(base),
      t: interpolate,
    }
  }, [locale])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAccountSecurityI18n(): AccountSecurityI18nContextValue {
  const ctx = useContext(Ctx)
  if (ctx) return ctx
  return { locale: 'en', dir: 'ltr', messages: en, t: interpolate }
}
