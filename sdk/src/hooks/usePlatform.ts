import { useEffect, useState } from 'react'
import { getBridge } from '../bridge'
import type { PlatformSnapshot } from '../bridge'

const STANDALONE: PlatformSnapshot = {
  user: null,
  apps: [],
  activeApp: null,
  isPlatformMode: false,
}

/**
 * Live platform context from the host (user, apps, active app), delivered over
 * the bridge. Re-renders when the host pushes updates. Returns a standalone
 * snapshot when not running inside the platform.
 */
export function usePlatform(): PlatformSnapshot {
  const [snapshot, setSnapshot] = useState<PlatformSnapshot>(
    () => getBridge()?.getContext() ?? STANDALONE
  )

  useEffect(() => {
    const bridge = getBridge()
    if (!bridge) return
    return bridge.subscribe(setSnapshot)
  }, [])

  return snapshot
}
