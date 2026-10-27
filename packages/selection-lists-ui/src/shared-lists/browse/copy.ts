/**
 * Copy for the shared-read flow, worded as the approved frames word it
 * (design/frames/selection-lists-shared 01 / 02 / 03 / 11).
 *
 * The package has no i18n catalog yet (the 4.0.0 flows hard-code English as
 * well); every user-facing string of this flow lives here so a catalog can
 * replace the file without touching a component. Names of organizations are
 * deliberately absent: the package does not know the active organization's
 * display name, so the copy says "your organization".
 */

import type {
  AuthorPrincipalKind,
  ListSourceGroup,
  SelectionListVisibility,
  VisibilityFilter,
} from '../core'

/** Visibility labels in a table row / on a detail header. */
export const VISIBILITY_LABEL: Record<
  SelectionListVisibility,
  { row: string; detail: string; glyph: string }
> = {
  private: { row: 'Private', detail: 'Private', glyph: '○' },
  org: { row: 'Organization', detail: 'Organization', glyph: '◉' },
  platform: { row: 'Common', detail: 'Common list', glyph: '◎' },
}

export const VISIBILITY_FILTER_OPTIONS: ReadonlyArray<{
  value: VisibilityFilter
  label: string
}> = [
  { value: 'any', label: 'Any' },
  { value: 'private', label: 'Private' },
  { value: 'org', label: 'Organization' },
  { value: 'platform', label: 'Common' },
]

export const GROUP_COPY: Record<
  ListSourceGroup,
  { title: string; detail: string | null }
> = {
  own: { title: 'Your organization', detail: null },
  common: {
    title: 'Common lists',
    detail: 'provided by FuzeFront to every organization',
  },
}

export const INDEX_COPY = {
  heading: 'Selection Lists',
  toggleLabel: 'Include common lists',
  visibilityGroupLabel: 'Visibility',
  statusLabel: 'Status',
  loadMore: 'Load more',
  loadMoreFailed: "Couldn't load more lists.",
  retry: 'Retry',
  errorTitle: "Couldn't load lists",
  errorBody: 'Nothing was changed. The toggle and filters keep their values for the retry.',
  emptyTitle: 'No lists yet',
  emptyBody:
    'Your organization has no lists, and no common lists are published. Create one to start offering values in forms.',
  emptyCta: '+ New list',
  emptySharedOffTitle: 'No lists you have a role on',
  emptySharedOffBody:
    "You can still read your organization's shared lists and the common lists — they're hidden by the toggle.",
  emptySharedOffCta: 'Include common lists',
  emptyFilteredTitle: 'No lists match this filter',
  emptyFilteredBody: 'Try another visibility, or choose Any.',
  showCommonOnly: 'Show common lists only',
  visibilityAny: 'Show any visibility',
  columns: {
    name: 'Name',
    key: 'Key',
    visibility: 'Visibility',
    access: 'Your access',
    values: 'Values',
    updated: 'Updated',
  },
  archived: 'Archived',
  machine: 'M',
} as const

export const ACCESS_LABEL = {
  editable: { row: 'You can edit', detail: 'You can edit' },
  'read-only': { row: 'Read-only', detail: 'Read-only for you' },
} as const

export const FORK_BADGE_LABEL = 'Fork'

export const OWNER_HINT: Record<Exclude<AuthorPrincipalKind, 'unknown'>, string> = {
  user: 'It was created by a user, not set up automatically.',
  system: 'It was set up automatically for your organization.',
  'deleted-user': "Its creator's account has been deleted.",
}

export const NOTICE_COPY = {
  platform: {
    title: 'A common list, shared by every organization',
    lead: "FuzeFront provides this list to every organization. You can view it and pick its values in any form, but you can't change it here — a change would affect every organization at once.",
    fork: 'To change it for your organization, fork it: your organization gets its own copy with the same key. If you share the fork with everyone in your organization (the default), every form that uses this key switches to it; a private draft is used only by people you give a role, and everyone else keeps the common list. Values already saved in records keep showing correctly.',
  },
  org: {
    title: 'Shared with everyone in your organization',
    body: "You can view this list and pick its values in forms. Being a member lets you read a list, never change it. To change it, ask the list's owner for an editor role.",
  },
  private: {
    title: "You can view this list but can't change it",
    body: "Your role on this list lets you read it and pick its values in forms. To change it, ask the list's owner for an editor role.",
  },
  shadowed: {
    title: 'Your organization uses its own version of this list',
    body: 'Forms in your organization use your version instead of this one. Changes to the common list do not reach your version automatically.',
    open: 'Open your version',
  },
  lookupFailed: "Couldn't check for your organization's version.",
  lookupRetry: 'Retry',
} as const

export const DETAIL_COPY = {
  breadcrumbRoot: 'Selection Lists',
  tabsLabel: 'List sections',
  tabValues: 'Values',
  tabTranslations: 'Translations',
  loadingLabel: 'Loading list',
  factsLabel: 'List facts',
  factOwner: 'Owned by',
  factVisibility: 'Who can see it',
  factValues: 'Values',
  factAccess: 'Your access',
  ownerPlatform: 'FuzeFront platform — not your organization',
  ownerOrg: 'Your organization',
  visibilityPlatform:
    'Everyone in every organization. A common list never becomes private again.',
  visibilityOrg: 'Everyone in your organization.',
  visibilityPrivate: 'Only people who hold a role on it.',
  accessPlatform: 'View and pick. You have no role on this list.',
  accessReadOnly: 'View and pick.',
  notFoundTitle: 'List not found',
  notFoundBody:
    "No list with that id, or you can't read it.",
  notFoundBack: 'Back to all lists',
  errorTitle: "Couldn't load this list",
  errorBody: 'Nothing has been changed.',
  valuesErrorTitle: "Couldn't load values",
  valuesErrorBody:
    'Nothing has been changed. The badge and notice above stay — they came from the list, which did load.',
  valuesEmptyTitle: 'No values to pick from',
  valuesEmptyBody:
    'This list has no active values yet. Forms that use it show “No options available”. Only someone with a role on the list can add values.',
  valuesLoadMore: 'Load more values',
  colLabel: 'Label',
  colCode: 'Code',
  colStatus: 'Status',
  colItemId: 'Item id',
  statusActive: 'active',
  statusArchived: 'archived',
  valuesFootReadOnly: 'read-only',
  valuesFootNote: "Changes happen in your organization's fork",
  retry: 'Retry',
} as const

export const TRANSLATIONS_COPY = {
  heading: 'Translations',
  language: 'Language',
  translated: 'Translated',
  notes: 'Notes',
  source: '(source)',
  machine: 'M',
  machineCount: (n: number) => `${n} machine`,
  staleCount: (n: number) => `${n} stale`,
  emptyTitle: 'No languages yet',
  emptyBody: 'This list has no translations to show.',
  errorTitle: "Couldn't load translations",
  errorBody: 'Nothing has been changed.',
  localeEmptyTitle: 'No translations yet',
  localeEmptyBody: 'Nothing is translated into this language yet.',
  back: '← All languages',
  code: 'Code',
  target: 'Translation',
  fallback: 'Falls back to the source language',
  sourceChanged: 'Source changed — may need re-translation',
  retry: 'Retry',
} as const
