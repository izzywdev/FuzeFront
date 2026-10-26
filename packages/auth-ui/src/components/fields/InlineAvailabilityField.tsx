import React, { useEffect, useRef, useState } from 'react'
import { InlineValidatedInput, Spinner } from '@fuzefront/design-system'
import type { SignupEmailAvailability } from '../../types'
import { AUTH_INPUT_STYLE } from '../controlStyles'
import { DEFAULT_SIGNUP_LABELS, type SignUpLabels } from '../signup/labels'

export type AvailabilityState = 'idle' | 'checking' | 'available' | 'taken' | 'error'

export interface InlineAvailabilityFieldProps {
  value: string
  onChange: (value: string) => void
  /**
   * `GET /v1/security/signup/email-available`. Optional — with no checker the
   * field never shows an availability signal. FAIL-OPEN: a rejection renders the
   * `error` state and never blocks anything.
   */
  check?: (email: string, signal?: AbortSignal) => Promise<SignupEmailAvailability>
  /** Debounce before a check fires, in ms. Default 500. */
  debounceMs?: number
  /** Where the "Sign in instead?" link goes when the address is already registered. */
  signInHref?: string
  /** SPA handler for the "Sign in instead?" link (the href is still rendered). */
  onSignInInstead?: () => void
  /** Reports each availability transition (e.g. for analytics / the parent form). */
  onStateChange?: (state: AvailabilityState) => void
  id?: string
  name?: string
  disabled?: boolean
  labels?: Partial<SignUpLabels>
}

// Cheap shape gate so we never fire a lookup for obviously-incomplete input.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Work-email field with a DEBOUNCED inline availability check.
 *
 * idle → (typing stops, address is well-formed) → checking → available | taken | error.
 * A stale response (the user kept typing) is discarded, and an in-flight request is
 * aborted. **Fail-open by contract:** `error` is informational only — this component
 * never disables the form, and `taken` is advisory (offers "Sign in instead?"; the
 * authoritative duplicate check is the 409 from `POST /signup`).
 *
 * Hooks: the status chip carries `data-avail="checking|available|taken|error"`; the
 * wrapper carries `data-avail-state` (also while `idle`) and the frame's
 * `data-state="email-idle|email-checking|email-available|email-taken|email-check-error"`.
 */
export function InlineAvailabilityField({
  value,
  onChange,
  check,
  debounceMs = 500,
  signInHref = '/login',
  onSignInInstead,
  onStateChange,
  id = 'fzf-signup-email',
  name = 'email',
  disabled,
  labels: overrides,
}: InlineAvailabilityFieldProps) {
  const labels = { ...DEFAULT_SIGNUP_LABELS, ...overrides }
  const [state, setState] = useState<AvailabilityState>('idle')
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange
  const checkRef = useRef(check)
  checkRef.current = check

  useEffect(() => {
    const email = value.trim()
    if (!checkRef.current || !LOOKS_LIKE_EMAIL.test(email)) {
      setState('idle')
      return
    }
    // Typing resets to idle straight away; the lookup only starts after the pause.
    setState('idle')
    const controller = new AbortController()
    let live = true
    const timer = setTimeout(() => {
      setState('checking')
      checkRef.current!(email, controller.signal)
        .then(res => {
          if (live) setState(res && res.available === false ? 'taken' : 'available')
        })
        .catch(() => {
          // Fail-open: an aborted/stale call is ignored; any real failure is "couldn't check".
          if (live && !controller.signal.aborted) setState('error')
        })
    }, debounceMs)
    return () => {
      live = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [value, debounceMs])

  useEffect(() => {
    onStateChangeRef.current?.(state)
  }, [state])

  const accessory =
    state === 'checking' ? (
      <span data-avail="checking" className="fzf-su-avail fzf-su-avail--checking">
        <Spinner size={13} color="var(--text-tertiary)" aria-hidden="true" /> {labels.availChecking}
      </span>
    ) : state === 'available' ? (
      <span data-avail="available" className="fzf-su-avail fzf-su-avail--available">
        <svg viewBox="0 0 20 20" fill="none" className="fzf-su-avail__icon" aria-hidden="true">
          <path d="M4 10.5 8 14.5 16 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {labels.availAvailable}
      </span>
    ) : state === 'taken' ? (
      <span data-avail="taken" className="fzf-su-avail fzf-su-avail--taken">
        {labels.availTaken}
      </span>
    ) : state === 'error' ? (
      <span data-avail="error" className="fzf-su-avail fzf-su-avail--error">
        {labels.availError}
      </span>
    ) : undefined

  const help =
    state === 'taken' ? (
      <>
        {labels.availTakenHelp}{' '}
        <a
          className="fzf-su-link"
          href={signInHref}
          data-action="signin-instead"
          onClick={e => {
            if (onSignInInstead) {
              e.preventDefault()
              onSignInInstead()
            }
          }}
        >
          {labels.availSignInInstead}
        </a>
      </>
    ) : state === 'error' ? (
      labels.availErrorHelp
    ) : (
      labels.availIdleHelp
    )

  return (
    <div
      className="fzf-su-field"
      data-avail-state={state}
      data-state={state === 'error' ? 'email-check-error' : `email-${state}`}
    >
      <InlineValidatedInput
        id={id}
        name={name}
        type="email"
        autoComplete="email"
        inputMode="email"
        label={labels.emailLabel}
        placeholder={labels.emailPlaceholder}
        value={value}
        disabled={disabled}
        aria-required="true"
        style={AUTH_INPUT_STYLE}
        accessory={accessory}
        help={help}
        state={state === 'available' ? 'valid' : state === 'taken' ? 'invalid' : state === 'checking' ? 'checking' : 'idle'}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
    </div>
  )
}
