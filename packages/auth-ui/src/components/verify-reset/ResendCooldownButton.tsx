import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@fuzefront/design-system'
import { DEFAULT_VERIFY_RESET_LABELS, type VerifyResetLabels } from './types'

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export interface ResendCooldownButtonProps {
  /**
   * Performs the resend. Resolving (including after surfacing a handled 429)
   * restarts the cooldown; rejecting leaves the button usable so the user can retry.
   */
  onResend: () => Promise<unknown>
  /** Seconds to wait between sends. Default 60. */
  cooldownSeconds?: number
  /** Start already cooling down (the link was just sent). Default true. */
  startInCooldown?: boolean
  labels?: Partial<VerifyResetLabels>
}

/**
 * ResendCooldownButton — disabled with a live m:ss counter during cooldown,
 * then re-enabled. Deadline-based (not tick-counting) so a backgrounded tab
 * catches up correctly.
 */
export function ResendCooldownButton({
  onResend,
  cooldownSeconds = 60,
  startInCooldown = true,
  labels: overrides,
}: ResendCooldownButtonProps) {
  const labels = { ...DEFAULT_VERIFY_RESET_LABELS, ...overrides }
  const endsAt = useRef<number>(startInCooldown ? Date.now() + cooldownSeconds * 1000 : 0)
  const [remaining, setRemaining] = useState(startInCooldown ? cooldownSeconds : 0)
  const [pending, setPending] = useState(false)
  const cooling = remaining > 0

  useEffect(() => {
    if (!cooling) return
    const id = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((endsAt.current - Date.now()) / 1000)))
    }, 1000)
    return () => clearInterval(id)
  }, [cooling])

  const startCooldown = useCallback(() => {
    endsAt.current = Date.now() + cooldownSeconds * 1000
    setRemaining(cooldownSeconds)
  }, [cooldownSeconds])

  const handleClick = async () => {
    if (cooling || pending) return
    setPending(true)
    try {
      await onResend()
      startCooldown()
    } catch {
      // The owning flow renders the failure; leave the button usable.
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      data-action="resend"
      data-state={cooling ? 'cooldown' : pending ? 'pending' : 'ready'}
      disabled={cooling || pending}
      onClick={handleClick}
    >
      {cooling ? labels.resendIn(formatCountdown(remaining)) : pending ? labels.resending : labels.resendNow}
    </Button>
  )
}
