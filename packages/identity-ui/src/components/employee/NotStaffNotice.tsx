import { Alert } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'

/**
 * The fail-closed 403 (03-states.html c4) — a non-Employee reaching `/staff`.
 * Rendered IN PLACE with zero cross-org data, never a sign-in redirect (only
 * a 401 re-authenticates; this is an authorization result on a valid
 * session — mirrors `PermissionDeniedNotice`'s pattern in
 * `frontend/src/components/portalsDirectory`).
 */
export function NotStaffNotice() {
  const { messages } = useIdentityI18n()
  const e = messages.employeeConsole

  return (
    <div data-state="forbidden" data-http="403" data-error-code="FORBIDDEN">
      <Alert tone="warning" title={e.notStaffTitle} role="alert">
        {e.notStaffBody}
      </Alert>
    </div>
  )
}
