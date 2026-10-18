import { describe, expect, it } from 'vitest'
import {
  mobileDistributionLinks,
  mobileInstallTarget,
} from '../appManifest'

const distribution = {
  appleAppStoreUrl: 'https://apps.apple.com/app/id123456789',
  googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.example.app',
  apkUrl: 'https://github.com/example/app/releases/latest/download/app.apk',
}

describe('mobile app install destinations', () => {
  it('keeps every declared store and APK link for the application catalog', () => {
    expect(mobileDistributionLinks(distribution)).toEqual([
      { href: distribution.appleAppStoreUrl, label: 'App Store' },
      { href: distribution.googlePlayUrl, label: 'Google Play' },
      { href: distribution.apkUrl, label: 'Download APK' },
    ])
  })

  it('uses the matching store in a mobile browser', () => {
    expect(
      mobileInstallTarget(distribution, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', false)
    ).toEqual({ href: distribution.appleAppStoreUrl, label: 'App Store' })
    expect(
      mobileInstallTarget(distribution, 'Mozilla/5.0 (Linux; Android 14)', false)
    ).toEqual({ href: distribution.googlePlayUrl, label: 'Google Play' })
  })

  it('falls back to the APK on Android, and never prompts installed or desktop sessions', () => {
    expect(
      mobileInstallTarget(
        { apkUrl: distribution.apkUrl },
        'Mozilla/5.0 (Linux; Android 14)',
        false
      )
    ).toEqual({ href: distribution.apkUrl, label: 'Download APK' })
    expect(mobileInstallTarget(distribution, 'Mozilla/5.0 (Linux; Android 14)', true)).toBeNull()
    expect(mobileInstallTarget(distribution, 'Mozilla/5.0 (Windows NT 10.0)', false)).toBeNull()
  })
})
