import type { ReactNode } from 'react'
import { NotStaffNotice } from './NotStaffNotice'

export interface StaffGuardProps {
  /** Whether the caller is an Employee. See types.ts module doc — this is a
   * CONTROLLED, host-resolved flag; StaffGuard itself never fetches or
   * re-derives it. */
  isEmployee: boolean
  children: ReactNode
}

/**
 * The client-side gate for the whole staff console (03-states.html c4). A
 * non-Employee never mounts `children` — no cross-org fetch is ever
 * triggered for them, satisfying "403 FORBIDDEN (whole console)... with zero
 * cross-org data" (manifest `commissionedByApproval`).
 */
export function StaffGuard({ isEmployee, children }: StaffGuardProps) {
  if (!isEmployee) return <NotStaffNotice />
  return <>{children}</>
}
