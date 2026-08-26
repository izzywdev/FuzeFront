import { Badge, RoleBadge } from '@fuzefront/design-system'
import type { OrgRole } from '../../types'

export interface MembershipRoleBadgeProps {
  /** The caller's real `user_role` for this org — `null` = visible but not a member. */
  role: OrgRole | null
  /** Extra data-* hooks (e.g. `data-context-badge`) to spread onto the badge. */
  hooks?: Record<string, string | undefined>
}

/**
 * Membership role pill used across the switcher, "my orgs" list and per-org
 * context header — 03-switcher.html, 04-my-orgs.html, 02-org-context.html.
 *
 * Composes the DS `RoleBadge` for real roles (owner/admin/member/viewer) so
 * root's `user_role='member'` renders the DS's actual member tone — never a
 * fabricated MEMBER for someone who isn't. `role === null` (visible platform
 * org, no membership row) renders a distinct neutral "Guest" pill instead of
 * silently defaulting into a role that was never granted.
 */
export function MembershipRoleBadge({ role, hooks }: MembershipRoleBadgeProps) {
  if (!role) {
    return (
      <Badge tone="neutral" data-role="guest" {...hooks}>
        Guest
      </Badge>
    )
  }
  return <RoleBadge role={role} data-role={role} {...hooks} />
}
