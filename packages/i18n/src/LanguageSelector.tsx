import React, { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, type LanguageDescriptor } from './languages'
import { setLanguage } from './config'

/*
 * DESIGN-SYSTEM-FIRST
 * -------------------
 * This selector is styled ENTIRELY from "fuse seam" design-system tokens (the
 * CSS custom properties defined in design-system/tokens/*.css and consumed by
 * design-system Select.jsx). No hard-coded colors, spacing, type, radii, or
 * easings appear below — every value is a `var(--token)`.
 *
 * It deliberately mirrors the markup/behavior of the DS `Select` primitive
 * (labeled control, tokenized chevron, fuse-seam focus ring) rather than
 * inventing a new control. Once `@fuzefront/design-system` is published as a
 * resolvable package, the inner control should be swapped for the imported
 * `<Select>` component (see PR notes / "design-system gaps").
 *
 * RTL: positioning uses CSS *logical* properties (inset-inline-end,
 * padding-inline) so the chevron and padding mirror automatically when
 * `<html dir="rtl">` flips — the centralized direction manager owns the flip.
 */

const ChevronDown = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flex: 'none' }}
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export interface LanguageSelectorProps {
  /** Languages to offer; defaults to the full curated registry. */
  languages?: readonly LanguageDescriptor[]
  /** Visible label text; defaults to the translated `language.label` key. */
  label?: string
  /** Render the label visually hidden (still announced to screen readers). */
  hideLabel?: boolean
  /** Called after the language has changed, with the resolved code. */
  onChange?: (code: string) => void
  /** Optional id override (auto-generated otherwise, for label association). */
  id?: string
  className?: string
}

/**
 * Accessible language picker. Options show each language's native name
 * (endonym). Selecting a language drives `setLanguage`, which persists the
 * choice and flips document direction via the centralized manager.
 */
export function LanguageSelector({
  languages = LANGUAGES,
  label,
  hideLabel = false,
  onChange,
  id,
  className,
}: LanguageSelectorProps): React.ReactElement {
  const { t, i18n } = useTranslation()
  const generatedId = useId()
  const selectId = id ?? `fuzefront-language-${generatedId}`
  const labelText = label ?? t('language.label', { defaultValue: 'Language' })

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const resolved = await setLanguage(i18n, e.target.value)
    onChange?.(resolved)
  }

  const visuallyHidden: React.CSSProperties = {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: 0,
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        width: '100%',
      }}
    >
      <label
        htmlFor={selectId}
        style={
          hideLabel
            ? visuallyHidden
            : {
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-medium)',
                color: 'var(--text-secondary)',
                lineHeight: 1.2,
              }
        }
      >
        {labelText}
      </label>
      <div style={{ position: 'relative', width: '100%' }}>
        <select
          id={selectId}
          value={i18n.language}
          onChange={handleChange}
          aria-label={hideLabel ? labelText : undefined}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            // Logical padding: extra inline-end room for the chevron, mirrors in RTL.
            paddingBlock: 'var(--space-3)',
            paddingInlineStart: 'var(--space-3)',
            paddingInlineEnd: 'calc(var(--space-3) + var(--space-6))',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-regular)',
            lineHeight: 1.4,
            color: 'var(--text-primary)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            outline: 'none',
            cursor: 'pointer',
            textAlign: 'start',
            appearance: 'none',
            WebkitAppearance: 'none',
            MozAppearance: 'none',
            transition:
              'border-color var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard), background var(--duration-base) var(--ease-standard)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent-color)'
            e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-color)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code} lang={l.code}>
              {l.nativeName}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            insetInlineEnd: 'var(--space-3)',
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'inline-flex',
            alignItems: 'center',
            color: 'var(--text-tertiary)',
            pointerEvents: 'none',
          }}
        >
          <ChevronDown />
        </span>
      </div>
    </div>
  )
}
