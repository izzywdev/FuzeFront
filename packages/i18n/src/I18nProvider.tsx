import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { i18n as I18nInstance, Resource } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from './config'
import { attachDirectionManager } from './direction'

export interface I18nProviderProps {
  /** Bundled locale resources: { en: { common: {...} }, es: { common: {...} } }. */
  resources: Resource
  /** Optional initial language override; otherwise restored from storage/browser. */
  lng?: string
  /** Default namespace (default "common"). */
  defaultNS?: string
  /** Persist the selected language to localStorage (default true). */
  persist?: boolean
  /** Reuse a pre-built i18next instance (e.g. created in app bootstrap or tests). */
  instance?: I18nInstance
  /** Rendered until i18next has initialized. */
  fallback?: React.ReactNode
  children: React.ReactNode
}

/**
 * Initializes i18next (loading the bundled locale JSON and restoring the saved
 * language), wires the centralized direction manager to keep `<html dir/lang>`
 * in sync, and exposes the instance to the tree via react-i18next's provider.
 */
export function I18nProvider({
  resources,
  lng,
  defaultNS = 'common',
  persist = true,
  instance,
  fallback = null,
  children,
}: I18nProviderProps): React.ReactElement | null {
  const [i18n, setI18n] = useState<I18nInstance | null>(null)
  const detachRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let active = true
    createI18n({ resources, lng, defaultNS, persist, instance }).then((created) => {
      if (!active) return
      detachRef.current = attachDirectionManager(created)
      setI18n(created)
    })
    return () => {
      active = false
      detachRef.current?.()
      detachRef.current = null
    }
    // Intentionally init once; locale resources are bundled and stable per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const provided = useMemo(() => i18n, [i18n])
  if (!provided) return <>{fallback}</>

  return <I18nextProvider i18n={provided}>{children}</I18nextProvider>
}
