/**
 * Do-not-translate glossary. Brand terms must survive translation verbatim.
 * These are injected into the prompt and verified post-translation.
 */
export const DEFAULT_GLOSSARY: readonly string[] = Object.freeze([
  'FuzeFront',
  'fuse seam',
  'FuzeInfra',
  'Module Federation',
])

/** Terms from the glossary that actually appear in the source string. */
export function glossaryTermsIn(
  source: string,
  glossary: readonly string[] = DEFAULT_GLOSSARY
): string[] {
  return glossary.filter((term) =>
    source.toLowerCase().includes(term.toLowerCase())
  )
}

/**
 * True when every glossary term present in the source is also present
 * (verbatim, case-sensitive) in the translation.
 */
export function glossaryPreserved(
  source: string,
  translated: string,
  glossary: readonly string[] = DEFAULT_GLOSSARY
): boolean {
  return glossaryTermsIn(source, glossary).every((term) =>
    translated.includes(term)
  )
}
