import { useEffect, useState } from 'react'
import { BottomSheet, Button, Modal, StatusCallout } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import { isConflict } from '../../api/errors'
import type { MfaFactor } from '../../types'
import { Actions, useInFlight } from '../common/flowKit'
import { FACTOR_ICON, factorName } from './factorMeta'

type DialogState = 'confirm' | 'removing' | 'remove-last-blocked' | 'removed' | 'error'

export interface RemoveFactorDialogProps {
  /** The factor being removed; `null` closes the dialog. */
  factor: MfaFactor | null
  /** Number of OTHER active factors (drives the confirm copy only — the server decides). */
  otherCount: number
  /** `DELETE /mfa/factors/{id}`; a 409 rejection is the fail-closed remove-last guard. */
  onRemove: (factorId: string) => Promise<void>
  onClose: () => void
  /** Called after a successful removal (parent refreshes its list). */
  onRemoved?: () => void
  /** "Add another method" from the blocked state. */
  onAddAnother: () => void
  /** False when the add-method route is unavailable (flag OFF): the blocked state offers no dead link. */
  canAddAnother?: boolean
  /** `sheet` renders a bottom sheet (mobile / TWA); `modal` a centred dialog. */
  presentation?: 'modal' | 'sheet'
}

/**
 * Confirm-and-remove an MFA factor. The server is authoritative: removing the
 * only active factor under an enforced-MFA policy answers 409 and this dialog
 * renders the BLOCKED state (`remove-last-blocked`, `data-http-status="409"`)
 * routing the user to add another method first — the factor is never optimistically
 * removed from the list.
 */
export function RemoveFactorDialog({
  factor,
  otherCount,
  onRemove,
  onClose,
  onRemoved,
  onAddAnother,
  canAddAnother = true,
  presentation = 'modal',
}: RemoveFactorDialogProps) {
  const { messages: m, t } = useAccountSecurityI18n()
  const [state, setState] = useState<DialogState>('confirm')
  const inFlight = useInFlight()

  useEffect(() => {
    if (factor) setState('confirm')
  }, [factor])

  if (!factor) return null
  const name = factorName(m, factor.type)

  const confirm = () => inFlight(async () => {
    setState('removing')
    try {
      await onRemove(factor.factorId)
      setState('removed')
      onRemoved?.()
    } catch (err) {
      setState(isConflict(err) ? 'remove-last-blocked' : 'error')
    }
  })

  const title =
    state === 'remove-last-blocked'
      ? m.mfa.remove.blockedTitle
      : state === 'removed'
        ? t(m.mfa.remove.removedTitle, { name })
        : state === 'error'
          ? m.mfa.remove.errorTitle
          : t(m.mfa.remove.confirmTitle, { name })

  const target = (
    <div
      data-factor-id={factor.factorId}
      data-factor={factor.type}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        background: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-md)',
        margin: 'var(--space-3) 0',
      }}
    >
      <span aria-hidden="true">{FACTOR_ICON[factor.type]}</span>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <b>{name}</b>
        <small style={{ color: 'var(--text-tertiary)' }}>
          {state === 'remove-last-blocked' ? m.mfa.remove.blockedLast : (factor.label ?? '')}
        </small>
      </span>
    </div>
  )

  const body = (
    <div
      data-component="remove-factor-dialog"
      data-state={state}
      data-http-status={state === 'remove-last-blocked' ? '409' : undefined}
    >
      {state !== 'removed' && state !== 'error' && target}
      {(state === 'confirm' || state === 'removing') && (
        <>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
            {otherCount > 0 ? m.mfa.remove.confirmTextOthers : m.mfa.remove.confirmTextLast}
          </p>
          <Actions>
            <Button
              variant="danger"
              data-action="remove-confirm"
              onClick={() => void confirm()}
              disabled={state === 'removing'}
              aria-busy={state === 'removing' || undefined}
            >
              {state === 'removing' ? m.mfa.remove.removing : m.mfa.remove.confirm}
            </Button>
            <Button variant="ghost" data-action="cancel" onClick={onClose} disabled={state === 'removing'}>
              {m.mfa.remove.cancel}
            </Button>
          </Actions>
        </>
      )}
      {state === 'remove-last-blocked' && (
        <>
          <div data-error="remove-last">
            <StatusCallout tone="warning" icon="🔒">
              {m.mfa.remove.blockedText}
            </StatusCallout>
          </div>
          <Actions>
            {canAddAnother && (
              <Button variant="primary" data-action="add-factor" onClick={onAddAnother}>
                {m.mfa.remove.addAnother}
              </Button>
            )}
            <Button variant="ghost" data-action="dismiss" onClick={onClose}>
              {m.mfa.remove.keep}
            </Button>
          </Actions>
        </>
      )}
      {state === 'removed' && (
        <>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
            {m.mfa.remove.removedText}
          </p>
          <Actions>
            <Button variant="ghost" data-action="dismiss" onClick={onClose}>
              {m.mfa.remove.back}
            </Button>
          </Actions>
        </>
      )}
      {state === 'error' && (
        <>
          <StatusCallout tone="error" icon="!" title={m.mfa.remove.errorTitle}>
            {m.mfa.remove.errorText}
          </StatusCallout>
          <Actions>
            <Button variant="primary" data-action="retry" onClick={() => void confirm()}>
              {m.mfa.overview.retry}
            </Button>
            <Button variant="ghost" data-action="dismiss" onClick={onClose}>
              {m.mfa.remove.cancel}
            </Button>
          </Actions>
        </>
      )}
    </div>
  )

  return presentation === 'sheet' ? (
    <BottomSheet open title={title} onClose={onClose}>
      {body}
    </BottomSheet>
  ) : (
    <Modal open title={title} onClose={onClose}>
      {body}
    </Modal>
  )
}
