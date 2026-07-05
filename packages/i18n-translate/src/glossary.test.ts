import { describe, it, expect } from 'vitest'
import { DEFAULT_GLOSSARY, glossaryTermsIn, glossaryPreserved } from './glossary'

describe('glossary', () => {
  it('includes the FuzeFront brand terms', () => {
    expect(DEFAULT_GLOSSARY).toContain('FuzeFront')
    expect(DEFAULT_GLOSSARY).toContain('fuse seam')
  })

  it('detects which terms appear in a source string (case-insensitive)', () => {
    expect(glossaryTermsIn('Welcome to FuzeFront')).toEqual(['FuzeFront'])
    expect(glossaryTermsIn('the fuse seam glows')).toEqual(['fuse seam'])
    expect(glossaryTermsIn('nothing special here')).toEqual([])
  })

  it('passes when the brand term is kept verbatim in the translation', () => {
    expect(glossaryPreserved('Welcome to FuzeFront', 'Bienvenido a FuzeFront')).toBe(
      true
    )
  })

  it('fails when the brand term was translated/dropped', () => {
    expect(
      glossaryPreserved('Welcome to FuzeFront', 'Bienvenido a FrenteDeFusión')
    ).toBe(false)
  })

  it('passes when no glossary term is present in the source', () => {
    expect(glossaryPreserved('Dashboard', 'Panel')).toBe(true)
  })
})
