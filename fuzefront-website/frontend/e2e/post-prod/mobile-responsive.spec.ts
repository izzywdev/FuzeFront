import { test, expect } from '@playwright/test'
import { ROUTES } from '../routes'

/**
 * Post-production-only: runs against the LIVE site under real mobile device
 * emulation (see the `mobile-iphone` / `mobile-android` projects in
 * playwright.post-prod.config.ts — this spec is testMatch-scoped OUT of the
 * desktop `chromium` project so it never runs against a desktop viewport).
 *
 * This site has no responsive-layout test at all today: contrast.spec.ts and
 * navigation.spec.ts only ever run at desktop viewport. A page can pass both
 * and still be broken on a phone — horizontally scrollable, a nav toggle too
 * small to tap, or the desktop nav bleeding through under the `lg:` (1024px)
 * breakpoint Header.tsx switches on.
 *
 * The 44px minimum below is WCAG 2.5.5's tap-target floor — the same bar the
 * platform design system encodes as `--touch-target` for the app shell
 * (design-system/tokens/spacing.css). This site doesn't consume that CSS
 * token directly (it vendors only what its Tailwind build needs), but the
 * accessibility requirement it encodes applies here just the same.
 */

const TAP_TARGET_MIN = 44

for (const route of ROUTES) {
  test(`mobile layout is sound: ${route}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cookie-consent', 'accepted'))
    await page.goto(route, { waitUntil: 'networkidle' })

    const viewport = page.viewportSize()
    if (!viewport) throw new Error('no viewport configured for this project')

    // No horizontal overflow: the page must not be wider than the viewport
    // it's rendered in. Tolerance is 16px, not 1px, because headless
    // Chromium's CDP-based `isMobile` emulation reserves a classic desktop
    // scrollbar gutter (measured here at 14px) that `position: fixed; left-0
    // right-0` elements (e.g. Header.tsx) size against via the initial
    // containing block — window.innerWidth, which includes that gutter —
    // rather than document.documentElement.clientWidth, which excludes it.
    // Confirmed this reproduces on ANY page tall enough to need a vertical
    // scrollbar, independent of route content, and real phones use overlay
    // scrollbars with zero reserved width, so it cannot occur on an actual
    // device. A real overflow bug is orders of magnitude bigger than 16px.
    const OVERFLOW_TOLERANCE_PX = 16
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth, `horizontal overflow on ${route}: content ${scrollWidth}px vs viewport ${viewport.width}px`)
      .toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX)

    // Desktop nav (`hidden lg:flex`) must actually be hidden below the `lg`
    // breakpoint, and the mobile toggle must be the one visible — a broken
    // breakpoint class leaves both showing, or neither.
    const desktopNavLink = page.locator('header').getByRole('link', { name: 'Pricing', exact: true })
    await expect(desktopNavLink, `desktop nav bled through on ${route} at ${viewport.width}px wide`).toBeHidden()

    const menuButton = page.locator('header button[aria-label="Open menu"], header button[aria-label="Close menu"]')
    await expect(menuButton, `no mobile menu toggle visible on ${route}`).toBeVisible()

    const box = await menuButton.boundingBox()
    expect(box, `mobile menu toggle has no measurable box on ${route}`).not.toBeNull()
    if (box) {
      expect(box.width, `mobile menu toggle too narrow to tap on ${route}: ${box.width}px`).toBeGreaterThanOrEqual(TAP_TARGET_MIN)
      expect(box.height, `mobile menu toggle too short to tap on ${route}: ${box.height}px`).toBeGreaterThanOrEqual(TAP_TARGET_MIN)
    }

    // Opening the mobile menu must reveal real, tappable nav links — not just
    // an empty or squashed panel.
    await menuButton.click()
    const firstMobileLink = page.locator('header').getByRole('link', { name: 'Pricing', exact: true })
    await expect(firstMobileLink, `mobile menu didn't open (or nav links missing) on ${route}`).toBeVisible()
    const linkBox = await firstMobileLink.boundingBox()
    expect(linkBox, `mobile nav link has no measurable box on ${route}`).not.toBeNull()
    if (linkBox) {
      expect(linkBox.height, `mobile nav link too short to tap on ${route}: ${linkBox.height}px`).toBeGreaterThanOrEqual(TAP_TARGET_MIN)
    }
  })
}
