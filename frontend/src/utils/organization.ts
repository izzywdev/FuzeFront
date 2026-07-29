/**
 * Shared helpers for every "create organization" entry point in the shell.
 *
 * `POST /api/organizations` validates its body strictly (backend/src/routes/
 * organizations.ts):
 *
 *   - `slug` is REQUIRED, non-empty, ≤100 chars, and must match /^[a-zA-Z0-9_-]+$/
 *   - `type` must be one of 'platform' | 'organization' | 'personal' — the
 *     `organization_type_enum` created in migration 004 and extended in 009.
 *     There is no 'team' / 'enterprise' member, at the route OR in the DB.
 *   - there is no `description` column; free-form text has to live in `metadata`.
 *
 * The TopBar selector and the organizations page both posted
 * `{ name, description, type: 'team' }` — no slug, an invalid type — so the API
 * answered 400 "Validation failed" on *every* attempt and the UI, which only
 * console.error'd, appeared to do nothing. Building the payload here keeps all
 * the entry points on the one shape the backend actually accepts.
 */

/** The only type a user-created (non-platform, non-personal) org may have. */
export const ORGANIZATION_TYPE = 'organization' as const

/**
 * Slugify a display name into the backend's allowed alphabet.
 * Returns '' when the name has no representable characters (e.g. a purely
 * Hebrew/Arabic/CJK name) — callers must handle that via `slugForName`.
 */
export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)
}

/** A short random suffix used to build a fallback slug. */
export function newSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 8)
}

/**
 * Slug for `name`, falling back to `org-<suffix>` when nothing survives
 * slugification. FuzeFront ships RTL/CJK locales, so a name like "ארגון" would
 * otherwise derive to '' and be rejected as "Slug is required".
 */
export function slugForName(name: string, suffix: string): string {
  return deriveSlug(name) || `org-${suffix}`
}

/**
 * Human-readable message for a failed organization call.
 * Surfaces the backend's `error` plus its `details[]` (the per-field validation
 * reasons), which is the difference between "Failed to create organization" and
 * "Validation failed: Slug is required…".
 */
export function organizationErrorMessage(err: any, fallback: string): string {
  const data = err?.response?.data
  const base = data?.error ?? err?.message ?? fallback
  const details = data?.details
  if (Array.isArray(details) && details.length > 0) {
    return `${base}: ${details.join('; ')}`
  }
  return base
}
