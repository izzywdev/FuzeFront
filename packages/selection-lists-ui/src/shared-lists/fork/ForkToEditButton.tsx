/**
 * ForkToEditButton (frames 02, 03, 06) — the ONE action on a common list's
 * read-only detail: "Fork to edit…". It renders from `ForkCtaState` (decided by
 * `core#forkCtaFor`, never from a guess at the caller's role):
 *
 *  - `offer`      -> the button.
 *  - `forbidden`  -> the explanation, in place of the button, for the rest of the
 *                    session (a fork attempt already answered 403 FORBIDDEN).
 *  - everything else -> nothing. A pending or failed effective-list lookup, a
 *    list the organization already replaced, or a list that is not common never
 *    shows a Fork CTA; the read-only notice owns the "Couldn't check…" / "Open
 *    your version" wording.
 *
 * Flag OFF: nothing (the `hidden: flag-off` state, and a provider-less tree).
 */

import { Button } from '@fuzefront/design-system'
import { useSharedLists, type ForkCtaState } from '../core'
import { ForkForbiddenNotice } from './ForkRefusalNotice'
import { TOUCH_TARGET } from './ui'

export interface ForkToEditButtonProps {
  cta: ForkCtaState
  onFork: () => void
  /** Overrides the provider's organization name (used in the forbidden explanation). */
  organizationName?: string
  /** The list's name, for the forbidden explanation. */
  listName?: string
}

export function ForkToEditButton({
  cta,
  onFork,
  organizationName,
  listName,
}: ForkToEditButtonProps) {
  const shared = useSharedLists()
  if (!shared.enabled) return null
  if (cta.kind === 'forbidden')
    return (
      <ForkForbiddenNotice
        organizationName={organizationName}
        listName={listName}
      />
    )
  if (cta.kind !== 'offer') return null
  return (
    <Button
      style={TOUCH_TARGET}
      data-action="fork-to-edit"
      aria-haspopup="dialog"
      onClick={onFork}
    >
      Fork to edit…
    </Button>
  )
}
