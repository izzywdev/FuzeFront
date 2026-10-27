/**
 * Every user-visible string of the visibility flow (frames 08, 14), in one
 * place. English only for now: this package does not yet consume
 * `@fuzefront/i18n`, so the strings live behind functions that a translation
 * layer can replace without touching the components. Names and keys are
 * interpolated by the components inside `<bdi>` so they stay bidi-isolated.
 */

/** What the control calls the active organization when the host did not say. */
export const FALLBACK_ORG_NAME = 'your organization'

export const MSG = {
  label: 'Who can see this list',
  hint: 'People with a role below can always see it. This decides who else can read it and pick its values.',
  current: 'Current',

  privateTitle: 'Only people with a role',
  privateBadge: 'Private',
  privateDescForkLine:
    "For a fork: everyone else's forms use the common list if one is active; values saved from the common list show the common labels again.",
  privateDesc:
    'Only people given a role can read it and pick its values. Nobody else in the organization sees it.',
  orgBadge: 'Organization',
  orgDesc: 'Every member can read it and pick its values.',
  orgDescFork: ' As a fork, it replaces the common list for everyone.',
  platformTitle: 'Every organization',
  platformBadge: 'Common',
  platformDesc: "Publishes it as a common list. This can't be undone.",
  platformDescPending: ' Chosen — confirm below to publish.',

  // Read-only statement (the caller cannot manage access).
  readOnlyOnlyOwner: "Only the list's owner can change this.",
  readOnlyPrivate: 'only people with a role.',

  // Locked (a common list).
  lockedBadge: 'Locked',
  lockedBody:
    "Every organization may have saved this list's values, so it can't be made private or organization-only. To retire it, archive it — archived values keep showing everywhere.",

  // Loading / error.
  loading: 'Loading access settings',
  saving: 'Saving… the options are locked until the service answers.',
  loadError: "Couldn't load access settings. Nothing was changed.",
  retry: 'Retry',

  // Confirmations.
  cancel: 'Cancel',
  toPrivateTitle: (name: string) => `Make ${name} private?`,
  toPrivateWithoutRole: 'Members without a role can no longer see it.',
  toPrivateNothingDeleted:
    'Nothing is deleted; switch back to Organization at any time.',
  makePrivate: 'Make private',
  publishTitle: (name: string) =>
    `Publish “${name}” to every organization?`,
  publishLineRead:
    'Every organization can read it and pick its values; organizations that want changes will fork it.',
  publishLineIrreversible:
    'It can never become private or organization-only again',
  publishLineIrreversibleTail:
    ' — organizations will store its value ids. To retire it, archive it.',
  publishLineEdits:
    "Your later edits reach every organization that hasn't forked it.",
  publishKeyLabelBefore: 'Type the list key ',
  publishKeyLabelAfter: ' to confirm',
  publish: 'Publish as common list',
  publishing: 'Publishing…',

  // Outcomes.
  savedDismiss: 'Dismiss',
  errorOwnerTitle: "Only the list's owner can change who sees it",
  errorOwnerBody: "The previous setting is kept. (A list-editor can change values, not visibility.)",
  errorPublishTitle: "You can't publish common lists",
  errorPublishBody:
    'Publishing needs the platform operator permission. The list keeps its current visibility.',
  errorLockedTitle: "Common lists can't be made private",
  errorLockedBody:
    'The list was reloaded; nothing changed.',
  errorSessionTitle: 'Your session has expired',
  errorSessionBody: 'Sign in again, then retry. Nothing was changed.',
  errorGoneTitle: 'This list is no longer available',
  errorGoneBody: 'It may have been archived or removed. Nothing was changed.',
  errorRefusedTitle: "The service didn't accept that change",
  errorRefusedBody: 'The previous setting is kept.',
  errorForkTitle: 'Fork this common list to change it',
  errorForkBody: "A common list can't be edited in place. The previous setting is kept.",
  errorConflictTitle: 'The list changed while you were editing',
  errorConflictBody: 'Reload the list to see its current setting. Nothing was changed.',
  errorUnknownTitle: "Couldn't confirm the change",
  errorUnknownBody:
    'The list was reloaded so you can see its current setting. If it is not what you chose, try again.',
}
