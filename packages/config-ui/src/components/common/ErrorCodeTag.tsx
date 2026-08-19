import { Badge } from '@fuzefront/design-system'

/** A machine-readable error code chip — consumers branch on `code`, never on `message`. */
export function ErrorCodeTag({ code }: { code: string }) {
  return (
    <Badge tone="error" mono size="sm" data-error-code={code}>
      {code}
    </Badge>
  )
}
