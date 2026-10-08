import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8').trim()

describe('FuzeQuality Helm registration assets', () => {
  it('keeps the chart manifest and policy copies equal to their reviewed product sources', () => {
    expect(read('files/registration/manifest.json')).toBe(read('../../../registration/manifest.json'))
    expect(read('files/registration/policy.json')).toBe(read('../../../registration/policy.json'))
  })

  it('keeps the chart onboarding script equal to the shared onboarding-kit source', () => {
    expect(read('files/onboarding-kit/register.sh')).toBe(
      read('../../../../packages/onboarding-kit/bin/register.sh'),
    )
  })

  it('renders the prerequisite ConfigMaps even while the registration Job is disabled', () => {
    const template = read('templates/registration-assets.yaml')
    expect(template).toContain('.Values.registration.assets.enabled')
    expect(template).toContain('.Values.registration.configMapName')
    expect(template).toContain('.Values.registration.kitConfigMapName')
    expect(template).toContain('files/registration/manifest.json')
    expect(template).toContain('files/registration/policy.json')
    expect(template).toContain('files/onboarding-kit/register.sh')
  })
})
