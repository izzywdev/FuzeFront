/**
 * Placeholder extraction + validation.
 *
 * Translations MUST preserve every machine token verbatim, while still
 * allowing the human-readable words inside ICU sub-messages to be translated:
 *
 *  - i18next interpolation:  {{name}}, {{count}}  — preserved wholesale.
 *  - ICU MessageFormat:      {count, plural, =0 {No apps} one {# app} ...}
 *      The control surface — the argument name, the ICU keyword
 *      (plural/select/selectordinal/number/date/time), the selectors
 *      (=0, one, other, few, many, zero, two) and the `#` — must be preserved.
 *      The sub-message text ("No apps") is free to translate.
 *
 * We extract a normalized "signature" of the machine tokens from source and
 * translation and require them to match.
 */

// {{ ... }} (i18next).
const INTERP_RE = /\{\{[^}]+\}\}/g
// Simple single-brace ICU args with no nested braces, e.g. {name} or {date}.
const SIMPLE_ICU_RE = /\{[^{}]+\}/g
// ICU keywords + selectors that carry meaning and must survive translation.
const ICU_KEYWORDS = [
  'plural',
  'select',
  'selectordinal',
  'number',
  'date',
  'time',
  'duration',
]
const ICU_SELECTORS = ['zero', 'one', 'two', 'few', 'many', 'other']

export interface PlaceholderSignature {
  /** i18next {{interpolation}} tokens, verbatim, sorted. */
  interpolations: string[]
  /** Simple ICU args like {date}, only those WITHOUT nested sub-messages, sorted. */
  simpleIcu: string[]
  /** ICU control tokens (arg names, keywords, =N selectors, plural selectors, #), sorted. */
  icuControl: string[]
}

function uniqSorted(items: string[]): string[] {
  return [...new Set(items)].sort()
}

export function extractPlaceholders(text: string): PlaceholderSignature {
  const interpolations = text.match(INTERP_RE) ?? []

  const withoutInterp = text.replace(INTERP_RE, '')

  // Does this look like a structured ICU message (has a keyword)?
  const hasIcuStructure = ICU_KEYWORDS.some((kw) =>
    new RegExp(`,\\s*${kw}\\b`).test(withoutInterp)
  )

  let simpleIcu: string[] = []
  const icuControl: string[] = []

  if (hasIcuStructure) {
    // Argument names: `{<name> , <keyword>`.
    for (const m of withoutInterp.matchAll(/\{\s*([A-Za-z0-9_]+)\s*,\s*([A-Za-z]+)/g)) {
      icuControl.push(`arg:${m[1]}`)
      icuControl.push(`kw:${m[2]}`)
    }
    // Explicit `=N` selectors.
    for (const m of withoutInterp.matchAll(/(=\d+)\s*\{/g)) {
      icuControl.push(`sel:${m[1]}`)
    }
    // Named plural/select selectors immediately preceding a sub-message.
    for (const m of withoutInterp.matchAll(/\b([A-Za-z]+)\s*\{/g)) {
      const word = m[1].toLowerCase()
      if (ICU_SELECTORS.includes(word)) icuControl.push(`sel:${word}`)
    }
    // The plural value marker.
    if (withoutInterp.includes('#')) icuControl.push('hash:#')
  } else {
    // No ICU structure → any single-brace tokens are simple args.
    simpleIcu = withoutInterp.match(SIMPLE_ICU_RE) ?? []
  }

  return {
    interpolations: uniqSorted(interpolations),
    simpleIcu: uniqSorted(simpleIcu),
    icuControl: uniqSorted(icuControl),
  }
}

/**
 * True when `translated` preserves exactly the same machine tokens as `source`
 * (interpolations, simple ICU args, and ICU control surface). ICU sub-message
 * text may differ (it is the translated content).
 */
export function placeholdersPreserved(source: string, translated: string): boolean {
  const a = extractPlaceholders(source)
  const b = extractPlaceholders(translated)
  return (
    JSON.stringify(a.interpolations) === JSON.stringify(b.interpolations) &&
    JSON.stringify(a.simpleIcu) === JSON.stringify(b.simpleIcu) &&
    JSON.stringify(a.icuControl) === JSON.stringify(b.icuControl)
  )
}

/** Human-readable list of placeholder tokens in a string (for prompts/errors). */
export function listPlaceholders(text: string): string[] {
  const sig = extractPlaceholders(text)
  return [...sig.interpolations, ...sig.simpleIcu, ...sig.icuControl]
}
