import { StatusCallout } from '@fuzefront/design-system'
import type { ReactNode } from 'react'

/** The non-dismissible "this never touches production" promise — present on
 * the signed-out home page, the playground panel, and every playground
 * fail-closed state (frame 01/07/08 acceptanceNotes). */
export function SafetyNotice({ children }: { children?: ReactNode }) {
  return (
    <StatusCallout tone="info" title="Sandbox only" data-safety-notice="sandbox-only">
      {children ?? 'Every request here runs against documented examples in a sandbox. It never reaches a real production system.'}
    </StatusCallout>
  )
}
