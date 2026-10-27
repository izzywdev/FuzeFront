/**
 * SharedListsFeatureProvider — the one place the shared-lists release flag is
 * read inside this package (design record section 7, frames manifest
 * `hostMounting`).
 *
 * The package is host-agnostic: it never fetches flags itself. The host shell
 * evaluates `fuzefront.selection-lists.shared-lists` (release, default OFF,
 * web-exposed; `GET /api/flags` evaluates browser flags WITHOUT an org context,
 * so the flag is enabled globally rather than per org until that endpoint
 * carries one) and passes the boolean in, together with whether the active
 * organization is the platform organization:
 *
 *   <SharedListsFeatureProvider
 *     sharedLists={useFlag(SHARED_LISTS_FLAG_KEY)}
 *     isPlatformOrg={activeOrganization?.type === 'platform'}
 *   >
 *
 * FAIL-CLOSED. Anything other than the boolean `true` is OFF, and so is a tree
 * with no provider at all: every shared-lists element must be ABSENT (not
 * disabled) and no request may carry `include_shared` / `visibility`, so the
 * approved 4.0.0 behaviour is unchanged. A flag that is still loading is OFF
 * (the host's `useFlag` returns its default until `/api/flags` settles).
 *
 * This is NOT an authorization boundary: Permit stays the authority, and every
 * refusal still comes from the service.
 *
 * Renders no UI of its own — it only provides context.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'

/** The release flag key. Mirrors `FLAG_KEYS.SELECTION_LISTS_SHARED_LISTS` in `@fuzefront/feature-flags`. */
export const SHARED_LISTS_FLAG_KEY = 'fuzefront.selection-lists.shared-lists'

export interface SharedListsContextValue {
  /** The release flag. `false` ⇒ every shared-lists element is absent. */
  enabled: boolean
  /**
   * The active organization is the platform organization — gates the "Every
   * organization" (platform) visibility option. Always `false` while the flag
   * is OFF. The service still enforces `publish_platform`.
   */
  isPlatformOrg: boolean
  /**
   * The active organization's id — lets a flow tell a list the caller's own
   * organization owns from a common list read through the shared read. Optional:
   * absent ⇒ the flow falls back to the list's own `visibility`.
   */
  organizationId?: string
  /**
   * The active organization's display name, for copy such as "Fork “Priority”
   * for Globex Freight". Optional: absent ⇒ generic "your organization" copy.
   */
  organizationName?: string
}

/** What a tree with no provider sees: OFF. */
const OFF: SharedListsContextValue = Object.freeze({
  enabled: false,
  isPlatformOrg: false,
})

const SharedListsContext = createContext<SharedListsContextValue>(OFF)

export interface SharedListsFeatureProviderProps {
  /** The value of `fuzefront.selection-lists.shared-lists`. Default (and fail-safe): OFF. */
  sharedLists?: boolean
  /** The active organization is the platform org. Default: `false`. */
  isPlatformOrg?: boolean
  /** The active organization's id. Optional. */
  organizationId?: string
  /** The active organization's display name. Optional. */
  organizationName?: string
  children?: ReactNode
}

export function SharedListsFeatureProvider({
  sharedLists = false,
  isPlatformOrg = false,
  organizationId,
  organizationName,
  children,
}: SharedListsFeatureProviderProps) {
  const enabled = sharedLists === true
  const platform = enabled && isPlatformOrg === true
  const orgId = typeof organizationId === 'string' ? organizationId : undefined
  const orgName =
    typeof organizationName === 'string' && organizationName !== ''
      ? organizationName
      : undefined
  const value = useMemo<SharedListsContextValue>(
    () =>
      enabled
        ? {
            enabled,
            isPlatformOrg: platform,
            organizationId: orgId,
            organizationName: orgName,
          }
        : OFF,
    [enabled, platform, orgId, orgName]
  )
  return (
    <SharedListsContext.Provider value={value}>
      {children}
    </SharedListsContext.Provider>
  )
}

/**
 * The shared-lists flag state. Safe anywhere: with no provider mounted it
 * reports OFF rather than throwing, so a 4.0.0 host is untouched.
 */
export function useSharedLists(): SharedListsContextValue {
  return useContext(SharedListsContext)
}
