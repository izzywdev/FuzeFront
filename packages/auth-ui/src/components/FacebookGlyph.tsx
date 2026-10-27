import React from 'react'

// Official Facebook "f" mark colour — mandated by Meta's brand guidelines for
// third-party sign-in buttons; a trademark asset, not UI styling, so it is NOT
// tokenized. Mirrors the allow-marked GOOGLE_BRAND constant in GoogleGlyph.tsx.
const FACEBOOK_BRAND = '#1877F2' // ds-conformance-allow: third-party brand mark (Meta identity guidelines)

/** The official Facebook "f" mark, inlined so the vanilla build stays zero-dependency. */
export function FacebookGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill={FACEBOOK_BRAND}
        d="M24 12a12 12 0 10-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.6 4.5-4.6 1.3 0 2.6.2 2.6.2v2.9h-1.5c-1.4 0-1.9.9-1.9 1.8V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0024 12z"
      />
    </svg>
  )
}
