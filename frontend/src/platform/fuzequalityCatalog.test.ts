import { describe, expect, it } from 'vitest'
import { isFuzeQualityCatalogEntry } from './fuzequalityCatalog'

describe('isFuzeQualityCatalogEntry', () => {
  it('matches the legacy portal catalog shape by federation scope', () => {
    expect(isFuzeQualityCatalogEntry({
      id: '31cfca12-7429-4ddc-b390-7fe8ea495fc6',
      scope: 'fuzequality',
      remoteUrl: '/apps/fuzequality/assets/remoteEntry.js',
    })).toBe(true)
  })

  it('matches app-registry and remote URL variants', () => {
    expect(isFuzeQualityCatalogEntry({ id: 'app-id', slug: 'fuzequality' })).toBe(true)
    expect(isFuzeQualityCatalogEntry({
      id: 'app-id',
      remoteUrl: 'https://app.fuzefront.com/apps/fuzequality/assets/remoteEntry.js',
    })).toBe(true)
  })

  it('does not accept a display-name collision without a federation identity', () => {
    expect(isFuzeQualityCatalogEntry({ id: 'quality' })).toBe(false)
  })
})
