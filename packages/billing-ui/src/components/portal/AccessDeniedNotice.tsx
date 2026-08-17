import { Alert } from '@fuzefront/design-system';
import { useBillingI18n } from '../../i18n';

/**
 * Fail-closed 403 — the caller is not this portal's admin (no 'read' Permit
 * authority on the portal's org), surfaced by a REAL 401/403 from the
 * platform-subscription load (see api/portalBillingClient.ts). Shown IN
 * PLACE, never a sign-in redirect — only a 401 re-authenticates, and even
 * that never silently hides this: the flow renders this notice for either
 * status so a stale session reads clearly rather than as a blank page.
 * Mirrors frontend/src/components/portalsDirectory/PermissionDeniedNotice.tsx
 * and design/frames/portal-admin-consoles/04-master-states.html (d7).
 */
export function AccessDeniedNotice() {
  const { strings } = useBillingI18n();
  return (
    <div data-panel="portal-console" data-state="forbidden" data-http="403" data-error-code="FORBIDDEN">
      <Alert tone="warning" title={strings.accessDeniedHeading} role="alert">
        {strings.accessDeniedBody}
      </Alert>
    </div>
  );
}
