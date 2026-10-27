import React, { useEffect, useRef, useState } from 'react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { TurnstileContainer } from '@fuzefront/design-system'
import { DEFAULT_SIGNUP_LABELS, type SignUpLabels } from '../signup/labels'

/**
 * Cloudflare's documented TEST site key (always passes, visible widget). DEV ONLY:
 * a production page always receives its real key from `AuthMethods.captcha.siteKey`,
 * and the server verifies the token with the real secret — a token minted against
 * this key is rejected there (fail-closed), so it can never be a bypass.
 */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'

export type TurnstileFieldState = 'loading' | 'ready' | 'verified' | 'failed'

export interface TurnstileFieldProps {
  /** `AuthMethods.captcha.siteKey`. Defaults to Cloudflare's TEST key (dev only — see above). */
  siteKey?: string
  /** Receives the token when the challenge passes, and `null` whenever it is lost (expired / errored / reset). */
  onToken: (token: string | null) => void
  /** Bump to reset the widget and get a fresh token (e.g. after the server rejected the last one). */
  resetSignal?: number
  /** Force the `failed` presentation from outside (the server rejected the token). */
  failed?: boolean
  /** Widget language (BCP-47-ish; `auto` follows the browser). */
  language?: string
  labels?: Partial<SignUpLabels>
  onStateChange?: (state: TurnstileFieldState) => void
}

/**
 * TurnstileField — Cloudflare Turnstile (via `@marsidev/react-turnstile`) inside the
 * design-system `TurnstileContainer` shell.
 *
 * The widget runs `interaction-only`: invisible unless Cloudflare needs the user, so
 * the shell's own `loading → verified` states carry the UX and the iframe only shows
 * for a real challenge (`ready`). It stays mounted in every state so the token can
 * refresh. Render this ONLY when `AuthMethods.captcha` is present; the parent keeps
 * its submit disabled until `onToken` delivers a token.
 * Hooks: `data-turnstile` + `data-state="loading|ready|verified|failed"`.
 */
export function TurnstileField({
  siteKey = TURNSTILE_TEST_SITE_KEY,
  onToken,
  resetSignal = 0,
  failed = false,
  language = 'auto',
  labels: overrides,
  onStateChange,
}: TurnstileFieldProps) {
  const labels = { ...DEFAULT_SIGNUP_LABELS, ...overrides }
  const [state, setState] = useState<TurnstileFieldState>('loading')
  const widget = useRef<TurnstileInstance | undefined>(undefined)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken
  const onStateRef = useRef(onStateChange)
  onStateRef.current = onStateChange

  const shown: TurnstileFieldState = failed ? 'failed' : state

  useEffect(() => {
    onStateRef.current?.(shown)
  }, [shown])

  // A bump of `resetSignal` drops the stale token and asks Cloudflare for a new one.
  const firstSignal = useRef(true)
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false
      return
    }
    onTokenRef.current(null)
    setState('loading')
    widget.current?.reset()
  }, [resetSignal])

  return (
    <TurnstileContainer
      data-turnstile
      state={shown}
      labels={{
        loading: labels.turnstileLoading,
        ready: labels.turnstileReady,
        verified: labels.turnstileVerified,
        failed: labels.turnstileFailed,
        error: labels.turnstileError,
        brand: labels.turnstileBrand,
      }}
    >
      <Turnstile
        ref={widget}
        siteKey={siteKey}
        options={{ appearance: 'interaction-only', theme: 'auto', size: 'flexible', language }}
        onBeforeInteractive={() => setState('ready')}
        onAfterInteractive={() => setState(s => (s === 'ready' ? 'loading' : s))}
        onSuccess={token => {
          setState('verified')
          onTokenRef.current(token)
        }}
        onExpire={() => {
          // Cloudflare auto-refreshes an expired token; until it does there is none.
          onTokenRef.current(null)
          setState('loading')
        }}
        onTimeout={() => setState('loading')}
        onError={() => {
          onTokenRef.current(null)
          setState('failed')
        }}
        onUnsupported={() => {
          onTokenRef.current(null)
          setState('failed')
        }}
      />
    </TurnstileContainer>
  )
}
