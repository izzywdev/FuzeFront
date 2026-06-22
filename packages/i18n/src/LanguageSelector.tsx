import React, { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Select } from '@fuzefront/design-system'
import { LANGUAGES, type LanguageDescriptor } from './languages'
import { setLanguage } from './config'

/*
 * DESIGN-SYSTEM-FIRST
 * -------------------
 * This selector renders the "fuse seam" design-system <Select> primitive
 * (@fuzefront/design-system) rather than reproducing a control. All surface,
 * spacing, type, radii, focus-ring and the tokenized chevron come from the DS
 * component — zero hard-coded colors/spacing/type appear here.
 *
 * RTL: the DS Select styles with CSS *logical* properties (padding-inline,
 * inset-inline-end, text-align: start) so it mirrors automatically when
 * `<html dir="rtl">` flips. The centralized direction manager (this package)
 * owns that flip; the selector only drives the language change.
 */

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
 * Accessible language picker built on the design-system <Select>. Options show
 * each language's native name (endonym). Selecting a language drives
 * `setLanguage`, which persists the choice and flips document direction via the
 * centralized manager.
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

  return (
    <div className={className} style={{ width: '100%' }}>
      <Select
        id={selectId}
        // When hidden, omit the visible DS label and expose the name via
        // aria-label so the control stays in the accessibility tree.
        label={hideLabel ? undefined : labelText}
        aria-label={hideLabel ? labelText : undefined}
        value={i18n.language}
        onChange={handleChange}
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.nativeName}
          </option>
        ))}
      </Select>
    </div>
  )
}
