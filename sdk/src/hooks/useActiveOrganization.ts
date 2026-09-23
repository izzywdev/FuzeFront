import { useEffect, useState } from 'react'
import { getBridge } from '../bridge'

export interface ActiveOrganization {
  id: string
  name: string
}

/**
 * Hook to access and listen to active organization changes from FuzeFront host.
 * Returns null when in personal context or running standalone.
 */
export function useActiveOrganization(): ActiveOrganization | null {
  const [activeOrg, setActiveOrg] = useState<ActiveOrganization | null>(() => {
    return getBridge()?.getContext().activeOrganization ?? null
  })

  useEffect(() => {
    const bridge = getBridge()
    if (!bridge) return

    // If bridge provides onOrgSwitch (v2+), use it; otherwise subscribe to context
    if (typeof bridge.onOrgSwitch === 'function') {
      return bridge.onOrgSwitch(setActiveOrg)
    }

    return bridge.subscribe(ctx => {
      setActiveOrg(ctx.activeOrganization ?? null)
    })
  }, [])

  return activeOrg
}
