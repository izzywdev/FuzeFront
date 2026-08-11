import { Badge } from '@fuzefront/design-system'
import { MembershipRoleBadge } from './MembershipRoleBadge'
import type { OrgRole } from '../../types'

export type OrgContext =
  | { type: 'personal' }
  | { type: 'org'; role: OrgRole | null }

export interface OrgContextBadgeProps {
  context: OrgContext
}

/**
 * The page-header access badge — 01-personal-context.html's
 * `data-context-badge="personal"` panel pill and 02-org-context.html's
 * `data-context-badge="member"` MEMBER badge (never GUEST for root, once the
 * root-membership backend slice writes a real `member` row).
 */
export function OrgContextBadge({ context }: OrgContextBadgeProps) {
  if (context.type === 'personal') {
    return (
      <Badge tone="accent" data-context-badge="personal">
        ◎ Personal
      </Badge>
    )
  }
  return (
    <MembershipRoleBadge
      role={context.role}
      hooks={{ 'data-context-badge': context.role ?? 'guest' }}
    />
  )
}
