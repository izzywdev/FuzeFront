/**
 * "A fork attempt was refused 403 FORBIDDEN in this session" (frame 06: after
 * closing the dialog the detail replaces its Fork CTA with the explanation "for
 * the rest of the session"). In memory only — a reload asks the service again —
 * and keyed by organization, because the caller's role differs per organization.
 */

const forbidden = new Set<string>()

const keyOf = (organizationId: string | undefined): string =>
  organizationId ?? ''

export function hasForkForbidden(organizationId: string | undefined): boolean {
  return forbidden.has(keyOf(organizationId))
}

export function markForkForbidden(organizationId: string | undefined): void {
  forbidden.add(keyOf(organizationId))
}

/** Test seam: forget every refusal. */
export function resetForkSession(): void {
  forbidden.clear()
}
