import { StatusCallout } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'

/**
 * Fail-closed 403 rendered IN PLACE (02-states.html b6) — the directory is
 * an org owner/admin (or Employee/ReBAC) capability. Zero member data is
 * rendered; this is NEVER a sign-in redirect (only 401 re-authenticates).
 * `data-http="403"` / `data-error-code="FORBIDDEN"` per the frozen error body.
 */
export function DirectoryForbiddenNotice() {
  const { messages } = useIdentityI18n()
  const m = messages.directory

  return (
    <div data-state="forbidden" data-http="403" data-error-code="FORBIDDEN">
      <StatusCallout tone="error" icon="⛔" title={m.forbiddenTitle}>
        {m.forbiddenBody}
      </StatusCallout>
    </div>
  )
}
