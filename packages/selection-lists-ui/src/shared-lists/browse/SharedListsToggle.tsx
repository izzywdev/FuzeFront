/**
 * SharedListsToggle — the "Include common lists" switch (frame 01).
 *
 * Maps to the `include_shared` query parameter. Default ON while the release
 * flag is ON, because without it a member holding no instance roles sees an
 * empty index although every form offers them values. It is a real `switch`
 * (`aria-checked`), keyboard-operable with the DS focus ring.
 *
 * The design system's `Toggle` is a labelled checkbox and cannot carry
 * `role="switch"` / `aria-checked`; until it can, this composes the same
 * tokens locally (see the stage report: DS extraction candidate).
 */

import { INDEX_COPY } from './copy'

export interface SharedListsToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
}

export function SharedListsToggle({
  checked,
  onChange,
  label = INDEX_COPY.toggleLabel,
}: SharedListsToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-control="include-shared"
      onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        minBlockSize: 'var(--touch-target)',
        padding: 0,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          display: 'inline-block',
          inlineSize: 'var(--space-10)',
          blockSize: 'var(--space-6)',
          flex: 'none',
          borderRadius: 'var(--radius-pill)',
          border: 'var(--border-width) solid var(--border-color)',
          background: checked ? 'var(--accent-color)' : 'var(--bg-quaternary)',
          transition:
            'background var(--duration-base) var(--ease-standard)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            insetBlockStart: 'var(--space-1)',
            insetInlineStart: checked
              ? 'calc(100% - var(--space-5))'
              : 'var(--space-1)',
            inlineSize: 'var(--space-4)',
            blockSize: 'var(--space-4)',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--accent-foreground)',
            boxShadow: 'var(--shadow-sm)',
            transition:
              'inset-inline-start var(--duration-base) var(--ease-standard)',
          }}
        />
      </span>
      {label}
    </button>
  )
}
