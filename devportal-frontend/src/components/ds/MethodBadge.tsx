/**
 * MethodBadge — HTTP method → tone map on top of the base `Badge`.
 *
 * manifest.json's third `designSystemAdditions` entry: "the colors already
 * exist [on Badge]; the method→tone mapping is the addition, so every Fuze
 * surface that renders an HTTP method renders it identically." Per this PR's
 * scope the mapping itself stays local (deferred to a foundation PR — see PR
 * body); it composes the EXISTING base `Badge` with no new tokens.
 */
import { Badge, type BadgeProps } from '@fuzefront/design-system'

const METHOD_TONE: Record<string, BadgeProps['tone']> = {
  GET: 'info',
  POST: 'success',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'error',
}

export function MethodBadge({ method, ...rest }: { method: string } & Omit<BadgeProps, 'tone' | 'mono' | 'children'>) {
  const upper = method.toUpperCase()
  return (
    <Badge tone={METHOD_TONE[upper] ?? 'neutral'} mono size="sm" {...rest}>
      {upper}
    </Badge>
  )
}
