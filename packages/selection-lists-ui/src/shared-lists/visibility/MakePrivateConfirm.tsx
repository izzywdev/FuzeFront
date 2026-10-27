/**
 * MakePrivateConfirm — the organization → private confirmation (frame 08 "Changing
 * it", frame 14 sheet). Private → organization needs none (it only widens
 * reading) and saves directly.
 *
 * The consequence lines that are specific to a fork render ONLY when the list
 * has `forked_from`: they keep stored values apart (common-list ids show the
 * common labels again; ids picked from the fork keep the fork's labels).
 */

import type { CSSProperties } from 'react'
import { Button } from '@fuzefront/design-system'
import { isFork, type SharedList } from '../core'
import { ConfirmSurface, type ConfirmPresentation } from './ConfirmSurface'
import { FALLBACK_ORG_NAME, MSG } from './messages'

export interface MakePrivateConfirmProps {
  list: SharedList
  presentation: ConfirmPresentation
  organizationName?: string
  onCancel: () => void
  onConfirm: () => void
}

const list: CSSProperties = {
  margin: 0,
  paddingInlineStart: 'var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-secondary)',
}

const touch: CSSProperties = { minBlockSize: 'var(--touch-target)' }

export function MakePrivateConfirm({
  list: target,
  presentation,
  organizationName = FALLBACK_ORG_NAME,
  onCancel,
  onConfirm,
}: MakePrivateConfirmProps) {
  const fork = isFork(target)
  return (
    <ConfirmSurface
      confirm="visibility-to-private"
      presentation={presentation}
      title={
        <>
          Make <bdi>{target.name}</bdi> private?
        </>
      }
      onDismiss={onCancel}
      actions={({ stacked }) => (
        <>
          <Button
            variant="ghost"
            type="button"
            fullWidth={stacked}
            style={stacked ? touch : undefined}
            data-action="cancel"
            data-initial-focus="true"
            onClick={onCancel}
          >
            {MSG.cancel}
          </Button>
          <Button
            variant="primary"
            type="button"
            fullWidth={stacked}
            style={stacked ? touch : undefined}
            data-action="confirm-visibility"
            onClick={onConfirm}
          >
            {MSG.makePrivate}
          </Button>
        </>
      )}
    >
      <ul style={list}>
        <li>{MSG.toPrivateWithoutRole}</li>
        {fork && (
          <>
            <li data-consequence="forms">
              Their forms use the <b>common</b> <bdi>{target.name}</bdi> list
              instead, if one is active — otherwise those forms show “List
              unavailable”.
            </li>
            <li data-consequence="stored-common">
              Values saved from the <b>common</b> list show the common labels
              again.
            </li>
            <li data-consequence="stored-fork">
              Values picked from <b>your fork</b> keep showing your fork's
              labels — they belong to <bdi>{organizationName}</bdi> and still
              resolve.
            </li>
          </>
        )}
        <li>{MSG.toPrivateNothingDeleted}</li>
      </ul>
    </ConfirmSurface>
  )
}
