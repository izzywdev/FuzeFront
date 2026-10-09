import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const read = (relativePath: string) =>
  readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8'
  ).trim()

describe('FuzeQuality Helm registration assets', () => {
  it('keeps the chart manifest and policy copies equal to their reviewed product sources', () => {
    expect(read('files/registration/manifest.json')).toBe(
      read('../../../registration/manifest.json')
    )
    expect(read('files/registration/policy.json')).toBe(
      read('../../../registration/policy.json')
    )
  })

  it('keeps the chart onboarding script equal to the shared onboarding-kit source', () => {
    expect(read('files/onboarding-kit/register.sh')).toBe(
      read('../../../../packages/onboarding-kit/bin/register.sh')
    )
  })

  it('makes monorepo registration and design-system dependencies available in the release image', () => {
    const dockerfile = read('../../../docker/Dockerfile')

    expect(dockerfile).toContain(
      'COPY packages/onboarding-kit /workspace/packages/onboarding-kit'
    )
    expect(dockerfile).toContain(
      'ln -s /workspace/FuzeQuality/node_modules /workspace/node_modules'
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

  it('runs portal registration as an explicit Argo PostSync hook', () => {
    const registration = read('templates/registration.yaml')

    expect(registration).toContain('argocd.argoproj.io/hook: PostSync')
    expect(registration).toContain(
      'argocd.argoproj.io/hook-delete-policy: BeforeHookCreation'
    )
    expect(registration).toContain(
      'helm.sh/hook: post-install,post-upgrade'
    )
    expect(registration).toContain('FUZEFRONT_REMOTE_HEALTH_URL')
    expect(registration).toContain('.Values.registration.remoteHealthUrl')
  })

  it('keeps the production portal registration, mount, and Vite federation identity aligned', () => {
    const manifest = JSON.parse(
      read('../../../registration/manifest.json')
    ) as {
      slug: string
      scopeLevel: string
      installMode: string
      organizationInstallMode: string
      integration: { remoteEntry: string; scope: string }
      routing: { path: string }
    }
    const production = parse(read('values-prod.yaml')) as {
      registration: { enabled: boolean }
      federatedMount: { enabled: boolean; host: string; slug: string }
    }
    const vite = read('../../../apps/web/vite.config.ts')
    expect(production.registration.enabled).toBe(true)
    expect(production.federatedMount).toMatchObject({
      enabled: true,
      host: 'app.fuzefront.com',
      slug: manifest.slug,
    })
    expect(manifest.routing.path).toBe(`/app/${manifest.slug}`)
    expect(manifest.integration).toMatchObject({
      scope: manifest.slug,
      remoteEntry: `/apps/${manifest.slug}/assets/remoteEntry.js`,
    })
    expect(manifest).toMatchObject({
      scopeLevel: 'both',
      installMode: 'both',
      organizationInstallMode: 'everyone',
    })
    expect(vite).toContain(`base: '/apps/${manifest.slug}/'`)
    expect(vite).toContain(`name: '${manifest.slug}'`)
  })
})
