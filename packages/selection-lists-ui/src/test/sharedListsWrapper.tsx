import type { ReactNode } from 'react'
import { SharedListsFeatureProvider } from '../shared-lists/core/SharedListsFeatureProvider'

/** A `renderHook` wrapper that mounts the feature provider with the flag in the given state. */
export function withSharedLists(sharedLists: boolean, isPlatformOrg = false) {
  return function Wrapper({ children }: { children?: ReactNode }) {
    return (
      <SharedListsFeatureProvider
        sharedLists={sharedLists}
        isPlatformOrg={isPlatformOrg}
      >
        {children}
      </SharedListsFeatureProvider>
    )
  }
}
