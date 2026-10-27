/**
 * PublishPlatformConfirm — publishing a list to EVERY organization (frame 08
 * "Platform operators only", frame 14 sheet). Irreversible: a common list can
 * never be demoted, so the operator must type the list key to continue.
 *
 *  - the key input opens EMPTY (never pre-filled), autocomplete / autocorrect /
 *    autocapitalize / spellcheck off, `dir="ltr"`, monospaced — a phone
 *    keyboard must not alter what is typed, whatever the page direction;
 *  - Publish carries the native `disabled` attribute until the value equals the
 *    key EXACTLY (case-sensitive, untrimmed; paste allowed) and again on any
 *    later mismatch;
 *  - while the request is in flight every control is natively disabled and
 *    Esc / a backdrop tap do nothing.
 *
 * Whether the operator MAY publish is never decided here: this component is
 * only rendered for a platform operator on a platform-owned list, and the
 * service still answers 403 if `publish_platform` is not held.
 */

import { useState, type CSSProperties } from 'react'
import { Button, Input, Spinner } from '@fuzefront/design-system'
import type { SharedList } from '../core'
import { ConfirmSurface, type ConfirmPresentation } from './ConfirmSurface'
import { MSG } from './messages'

export interface PublishPlatformConfirmProps {
  list: SharedList
  presentation: ConfirmPresentation
  /** `PATCH {visibility: "platform"}` is in flight. */
  publishing: boolean
  onCancel: () => void
  onConfirm: () => void
}

const list: CSSProperties = {
  margin: 0,
  marginBlockEnd: 'var(--space-3)',
  paddingInlineStart: 'var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-secondary)',
}

const keyText: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-primary)',
}

const inputMono: CSSProperties = { fontFamily: 'var(--font-mono)' }
const touch: CSSProperties = { minBlockSize: 'var(--touch-target)' }

export function PublishPlatformConfirm({
  list: target,
  presentation,
  publishing,
  onCancel,
  onConfirm,
}: PublishPlatformConfirmProps) {
  // Opens empty — never pre-filled with the key.
  const [typed, setTyped] = useState('')
  const matched = typed === target.key
  const state = publishing ? 'publishing' : matched ? 'matched' : 'empty'
  const keyNode = (
    <bdi dir="ltr" style={keyText}>
      {target.key}
    </bdi>
  )

  return (
    <ConfirmSurface
      confirm="publish-platform"
      presentation={presentation}
      title={MSG.publishTitle(target.name)}
      attrs={{ 'data-confirm-state': state, 'data-scope': 'platform-org' }}
      busy={publishing}
      onDismiss={onCancel}
      actions={({ stacked }) => (
        <>
          <Button
            variant="ghost"
            type="button"
            fullWidth={stacked}
            style={stacked ? touch : undefined}
            data-action="cancel"
            disabled={publishing}
            onClick={onCancel}
          >
            {MSG.cancel}
          </Button>
          <Button
            variant="primary"
            type="button"
            fullWidth={stacked}
            style={stacked ? touch : undefined}
            data-action="confirm-publish"
            disabled={publishing || !matched}
            aria-busy={publishing ? 'true' : undefined}
            onClick={onConfirm}
          >
            {publishing ? (
              <>
                <Spinner size={14} label={MSG.publishing} aria-hidden="true" />{' '}
                {MSG.publishing}
              </>
            ) : (
              MSG.publish
            )}
          </Button>
        </>
      )}
    >
      <ul style={list}>
        <li>{MSG.publishLineRead}</li>
        <li>
          <b>{MSG.publishLineIrreversible}</b>
          {MSG.publishLineIrreversibleTail}
        </li>
        <li>{MSG.publishLineEdits}</li>
      </ul>
      <Input
        label={
          <>
            {MSG.publishKeyLabelBefore}
            {keyNode}
            {MSG.publishKeyLabelAfter}
          </>
        }
        value={typed}
        onChange={e => setTyped(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && matched && !publishing) {
            e.preventDefault()
            onConfirm()
          }
        }}
        disabled={publishing}
        dir="ltr"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        style={inputMono}
        data-confirm-input="key"
      />
    </ConfirmSurface>
  )
}
