import type React from 'react'

/**
 * Control sizing for the redesigned auth flows, per the approved frames
 * (`design/frames/auth-experience/auth.css` `.input` / `.btn-ds`).
 *
 * The design-system `Input` / `Button` primitives size their text from
 * `--text-sm` (13px) and keep the control short (~39px). The frames call for
 * `--text-md` text and a 44px (`--touch-target`) input / 46px button. The DS
 * primitives merge a caller `style` last, so the flow overrides them here with
 * DS tokens only — no raw values, no change to the shared primitives' defaults.
 */
export const AUTH_INPUT_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-md)',
  minHeight: 'var(--touch-target)',
}

/** The frame's primary-button height: the 44px touch target + half a spacing step (= 46px). */
export const AUTH_BUTTON_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-md)',
  minHeight: 'calc(var(--touch-target) + var(--space-1) / 2)',
}
