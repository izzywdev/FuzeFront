import { Alert } from '@fuzefront/design-system'

/**
 * d6 · Permission-denied / read-only (fail-closed) — a caller without manage
 * authority (Permit ReBAC, server-side) gets a 403 shown IN PLACE. This is an
 * authorization result, never a sign-in redirect (only a 401 re-authenticates).
 *
 * `GET /api/v1/admin/portals` denies the WHOLE request on 403 today (no
 * partial/row-scoped authority) — there is no items array to render
 * alongside the notice, so "zero launch affordances" holds trivially: there
 * is no list at all, let alone a launch anchor or button. If the backend
 * later returns a partial, row-scoped 200 instead, the fail-closed contract
 * still holds via PortalRow/PortalCard's `canOpen={false}` path (renders
 * `[data-action-absent="open-portal"]`, never an anchor/button) — this
 * component only owns the banner.
 */
export function PermissionDeniedNotice() {
  return (
    <div data-state="forbidden" data-http="403" data-error-code="FORBIDDEN">
      <div className="pd-panel-body" data-panel="permission-denied">
        <Alert tone="warning" title="You don't have permission to open portals" role="alert">
          Your role can view the directory but not launch or manage a portal. There is nothing to
          open from here. Ask a platform administrator to grant portal-admin if you need access.
          This is an authorization result — you have <strong>not</strong> been signed out.
        </Alert>
      </div>
    </div>
  )
}
