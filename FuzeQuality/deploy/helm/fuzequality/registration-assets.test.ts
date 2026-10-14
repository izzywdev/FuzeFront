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
      routing: { path: string; host: string }
    }
    const production = parse(read('values-prod.yaml')) as {
      registration: { enabled: boolean }
      ingress: { enabled: boolean; host: string }
      federatedMount: { enabled: boolean; host: string; slug: string }
    }
    const vite = read('../../../apps/web/vite.config.ts')
    expect(production.registration.enabled).toBe(true)
    expect(production.federatedMount).toMatchObject({
      enabled: true,
      host: 'app.fuzefront.com',
      slug: manifest.slug,
    })
    expect(production.ingress).toMatchObject({
      enabled: true,
      host: 'fuzequality.fuzefront.com',
    })
    expect(manifest.routing.host).toBe(production.ingress.host)
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

  it('keeps the standalone PWA, TWA, Digital Asset Links, and health route aligned', () => {
    const registration = JSON.parse(read('../../../registration/manifest.json'))
    const twa = JSON.parse(read('../../../android/twa-manifest.json'))
    const pwa = JSON.parse(read('../../../apps/web/public/manifest.webmanifest'))
    const assetlinks = JSON.parse(
      read('../../../apps/web/public/.well-known/assetlinks.json')
    )
    const nginx = read('../../../docker/nginx.conf')

    expect(registration.modes).toContain('standalone')
    expect(twa).toMatchObject({
      packageId: 'com.fuzefront.fuzequality',
      host: registration.routing.host,
      startUrl: '/',
      fullScopeUrl: `https://${registration.routing.host}/`,
      minSdkVersion: 24,
    })
    expect(pwa).toMatchObject({ name: 'FuzeQuality', display: 'standalone' })
    expect(assetlinks[0].target).toMatchObject({
      namespace: 'android_app',
      package_name: twa.packageId,
      sha256_cert_fingerprints: [twa.fingerprints[0].value],
    })
    expect(nginx).toContain('location = /api/health')
    expect(nginx).toContain('proxy_pass http://fuzequality-backend:4180/health')
    expect(nginx).toContain('limit_req_zone $binary_remote_addr zone=fq_health:10m rate=10r/s')
    expect(nginx.match(/limit_req zone=fq_health burst=20 nodelay/g)).toHaveLength(2)
  })

  it('patches Bubblewrap generated Gradle to the reviewed Android minimum before assembly', () => {
    const workflow = read('../../../../.github/workflows/fuzequality-android-apk.yml')
    const patchStep = workflow.indexOf('Force FuzeQuality minSdkVersion 24')
    const buildStep = workflow.indexOf('Build FuzeQuality APK')

    expect(patchStep).toBeGreaterThan(-1)
    expect(buildStep).toBeGreaterThan(patchStep)
    expect(workflow).toContain("sed -i -E 's/minSdkVersion[[:space:]]+[0-9]+/minSdkVersion 24/g'")
    expect(workflow).toContain("grep -Eq 'minSdk(Version)?([[:space:]]+|[[:space:]]*=[[:space:]]*)24\\b'")
  })
})
