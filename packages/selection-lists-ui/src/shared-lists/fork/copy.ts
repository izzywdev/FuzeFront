/**
 * Fork flow — the words (frames 04, 05, 06, 12).
 *
 * Pure functions: every sentence the fork UI shows comes through here, so the
 * copy is reviewable against the approved frames in one file and a host that
 * later wires `@fuzefront/i18n` has a single seam to replace. Branching is on
 * `code` / `reason` / `scope` only — never on a server `message`.
 */

import type { QuotaScopeName } from '../core'

/** The org name used when the host has not passed one. */
export const GENERIC_ORGANIZATION = 'your organization'

/** The service's value cap per list (frame 06 `#too-large`). */
export const FORK_VALUE_CAP_LABEL = '5,000'

export interface QuotaFacts {
  scope: QuotaScopeName | undefined
  limit: number | undefined
  current: number | undefined
}

export interface QuotaCopy {
  title: string
  body: string
}

const hasNumbers = (q: QuotaFacts): q is QuotaFacts & {
  limit: number
  current: number
} => q.limit !== undefined && q.current !== undefined

/** 403 QUOTA_EXCEEDED on `POST …/fork` — copy chosen by `scope`. */
export function forkQuotaCopy(q: QuotaFacts, organization: string): QuotaCopy {
  switch (q.scope) {
    case 'org_lists':
      return {
        title: `${organization} has reached its list limit`,
        body: `${hasNumbers(q) ? `${q.current} of ${q.limit} organization lists are in use. ` : ''}A fork is a new list, so it counts. Archive a list you no longer need, or ask an admin about the limit. Nothing was created.`,
      }
    case 'user_lists':
      return {
        title: "You've reached your list limit",
        body: `You've reached the number of lists you can own${hasNumbers(q) ? ` (${q.current} of ${q.limit})` : ''}. Archive a list you own, or ask an admin about the limit. Nothing was created.`,
      }
    case 'list_items':
      return {
        title: 'This list is too large for your organization',
        body: `This common list has more values${hasNumbers(q) ? ` (${q.current})` : ''} than a list in your organization may hold${hasNumbers(q) ? ` (${q.limit})` : ''}. Nothing was created.`,
      }
    default:
      return {
        title: 'Limit reached',
        body: 'A limit was reached. Nothing was created.',
      }
  }
}

/**
 * 403 QUOTA_EXCEEDED on the restore PATCH. `user_lists` counts the fork's
 * CREATOR, who may not be the person restoring it, so it never says "you".
 */
export function restoreQuotaCopy(
  q: QuotaFacts,
  organization: string
): QuotaCopy {
  switch (q.scope) {
    case 'org_lists':
      return {
        title: `${organization} has reached its list limit`,
        body: `${hasNumbers(q) ? `${q.current} of ${q.limit} organization lists are active. ` : ''}Restoring makes this fork active again, so it counts. Archive a list you no longer need, or ask an admin about the limit. The fork stays archived.`,
      }
    case 'user_lists':
      return {
        title: "The fork's creator has reached their list limit",
        body: `The person who created this fork already has the most active lists they may create${hasNumbers(q) ? ` (${q.current} of ${q.limit})` : ''}. The fork stays archived.`,
      }
    default:
      return {
        title: 'Limit reached',
        body: 'A limit was reached. The fork stays archived.',
      }
  }
}

export interface ValueCounts {
  active: number
  archived: number
}

/**
 * "5 values (4 active, 1 archived)" — or the active count alone when the items
 * are not loaded. `brief` drops the breakdown (the 375 px sheet's "5 values").
 */
export function copiedValuesText(
  counts: ValueCounts | undefined,
  activeCount: number | undefined,
  brief = false
): string {
  if (counts) {
    const total = counts.active + counts.archived
    const base = `${total} ${plural(total, 'value')}`
    return brief ? base : `${base} (${counts.active} active, ${counts.archived} archived)`
  }
  if (activeCount !== undefined)
    return `${activeCount} active ${plural(activeCount, 'value')}`
  return 'Every value'
}

export function plural(n: number, noun: string): string {
  return n === 1 ? noun : `${noun}s`
}

/** "Sep 2" in UTC — or `undefined` for a missing / unparseable timestamp. */
export function shortDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}
