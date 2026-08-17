import { Badge } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'

export interface DerivedAccessTagProps {
  /** `'root'` renders the root-row label ("org-admin · root"); every other
   * row renders the generic "derived from root" label. */
  variant?: 'root' | 'default'
}

/**
 * The "Your access" pill in the cross-org explorer
 * (01-org-explorer.html `.emp-derived`, `[data-access="derived"]`). Access
 * is ALWAYS derived for an Employee row — there is no other variant, because
 * an Employee never holds a membership row (see types.ts module doc).
 */
export function DerivedAccessTag({ variant = 'default' }: DerivedAccessTagProps) {
  const { messages } = useIdentityI18n()
  const e = messages.employeeConsole
  return (
    <Badge tone="accent" dot data-access="derived">
      {variant === 'root' ? e.accessRoot : e.accessDerived}
    </Badge>
  )
}
