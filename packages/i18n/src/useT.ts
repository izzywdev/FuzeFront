import { useTranslation, type UseTranslationOptions } from 'react-i18next'

/**
 * Thin re-export of react-i18next's `useTranslation` under the FuzeFront name.
 * Keeping a single import surface (`useT`) across the platform means apps don't
 * depend on react-i18next directly and we can evolve the runtime later.
 *
 *   const { t } = useT()            // default "common" namespace
 *   const { t } = useT('settings')  // a specific namespace
 */
export function useT(
  ns?: string | string[],
  options?: UseTranslationOptions<undefined>
) {
  return useTranslation(ns, options)
}
