import { test, expect } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

// Resolve the frames dir without __dirname / import.meta so the spec runs
// identically whether the test runner treats this file as CommonJS or ESM
// (frontend/ is "type":"module"). The frames-gate is invoked from the repo root
// (`npx playwright test -c playwright.config.ts`); we also tolerate being run
// from within frontend/. We locate the committed frames dir directly.
function resolveFramesDir(): string {
  const rel = path.join('design', 'frames', 'locked-app-mode')
  const candidates = [
    path.resolve(process.cwd(), rel), // run from repo root (canonical)
    path.resolve(process.cwd(), '..', rel), // run from frontend/
  ]
  return candidates.find(c => fs.existsSync(c)) ?? candidates[0]
}

/**
 * PRE-PROD APPROVED-FRAMES GATE — Locked App Mode.
 *
 * Loads each of the four APPROVED static design frames in
 * `design/frames/locked-app-mode/` and asserts the visual/structural contract
 * each frame is the source of truth for. This is an INDEPENDENT gate that runs
 * NOW with no live stack (file:// URLs) — it pins the eventual built UI to the
 * approved white-label design:
 *
 *   01-white-label-login → locked-domain sign-in, product brand ONLY, auth
 *                          served hidden/same-origin.
 *   02-locked-shell      → full-screen product with its OWN chrome; NO 9-dots
 *                          launcher, NO org-switcher, NO return-to-portal, and
 *                          NO "FuzeFront" anywhere in the product surface.
 *   03-locked-mobile     → 375px white-label surface with a touch tab-bar.
 *   04-native-app-home   → each product is its OWN installed app (distinct
 *                          package id) — no single container app.
 *
 * These frames are HTML fixtures, not the React app; this spec verifies the
 * APPROVED design contract. The mirror is the federated-apps frames gate
 * (`federated-apps-frames.spec.ts`); both run from the root
 * `playwright.config.ts` and need no server.
 *
 * THE WHITE-LABEL INVARIANT: within the shipped product surface the string
 * "FuzeFront" must never appear. Design-review annotations that DO name the
 * platform live strictly OUTSIDE the product surface (`[data-role=
 * 'design-annotation']`, `.reviewer-note`) and are excluded from that check.
 */

const FRAMES_DIR = resolveFramesDir()

function frameUrl(file: string): string {
  return pathToFileURL(path.join(FRAMES_DIR, file)).href
}

test.describe('Approved frames gate — design/frames/locked-app-mode', () => {
  test('manifest lists four frames, each with an existing file + data-frame hook', async ({
    page,
  }) => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(FRAMES_DIR, 'manifest.json'), 'utf8')
    )
    expect(manifest.frames).toHaveLength(4)

    for (const frame of manifest.frames) {
      const file = path.join(FRAMES_DIR, frame.file)
      expect(fs.existsSync(file), `frame file missing: ${frame.file}`).toBe(true)
      await page.goto(frameUrl(frame.file))
      await expect(
        page.locator(`[data-frame='${frame.id}']`),
        `frame identity marker [data-frame='${frame.id}'] missing`
      ).toBeAttached()
    }
  })

  test('01-white-label-login: product brand only, no FuzeFront, auth actions present', async ({
    page,
  }) => {
    await page.goto(frameUrl('01-white-label-login.html'))

    await expect(
      page.locator('body[data-frame="01-white-label-login"]')
    ).toBeAttached()

    // The surface declares locked + white-label for the product.
    const surface = page.locator(
      '.locked-login[data-mode="locked"][data-whitelabel="true"][data-app="fuzesocial"]'
    )
    await expect(surface).toBeVisible()

    // Product brand is present…
    await expect(surface.locator('.brand-lockup .brand-name')).toHaveText(
      'FuzeSocial'
    )
    // …and the sign-in actions (password + social) are the platform auth, hidden
    // behind the product brand.
    await expect(surface.locator('[data-action="login"]')).toContainText(
      'Sign in to FuzeSocial'
    )
    await expect(surface.locator('[data-action="social-google"]')).toBeVisible()

    // WHITE-LABEL INVARIANT: the shipped product surface never says "FuzeFront".
    await expect(surface).not.toContainText('FuzeFront')
    // No 9-dots launcher / org-switcher on the login surface.
    await expect(surface.locator('[data-app="__launcher"]')).toHaveCount(0)
    await expect(surface.locator('[data-org-switcher]')).toHaveCount(0)
  })

  test('02-locked-shell: full-screen product, own chrome, no launcher/org/return-to-portal, no FuzeFront', async ({
    page,
  }) => {
    await page.goto(frameUrl('02-locked-shell.html'))

    await expect(
      page.locator('body[data-frame="02-locked-shell"]')
    ).toBeAttached()

    // Locked surface: chrome=none, and the anti-portal markers are all "absent".
    const surface = page.locator(
      '.locked-app[data-mode="locked"][data-chrome="none"][data-app="fuzesocial"]'
    )
    await expect(surface).toBeVisible()
    await expect(surface).toHaveAttribute('data-launcher', 'absent')
    await expect(surface).toHaveAttribute('data-org-switcher', 'absent')
    await expect(surface).toHaveAttribute('data-return-portal', 'absent')

    // The chrome that IS present is the PRODUCT's own (data-owner="app").
    await expect(
      surface.locator('header.app-topbar[data-owner="app"] .app-brand')
    ).toContainText('FuzeSocial')

    // WHITE-LABEL INVARIANT: no "FuzeFront", no return-to-portal control, no
    // 9-dots launcher anywhere inside the shipped product surface.
    await expect(surface).not.toContainText('FuzeFront')
    await expect(surface).not.toContainText('Return to portal')
    await expect(surface.locator('[data-app="__host_return"]')).toHaveCount(0)
    await expect(surface.locator('[data-app="__launcher"]')).toHaveCount(0)

    // The platform infra IS active but only ever named in a design-review
    // annotation that lives OUTSIDE the product surface — proving the services
    // exist without leaking into the product UI.
    const annotation = page.locator('[data-role="design-annotation"]')
    await expect(annotation).toContainText('FuzeFront')
    for (const infra of [
      'auth',
      'authz',
      'billing',
      'payments',
      'notifications',
      'sockets',
    ]) {
      await expect(
        annotation.locator(`.chip[data-infra="${infra}"][data-state="on"]`)
      ).toBeVisible()
    }
    // The annotation must NOT be a descendant of the product surface.
    await expect(surface.locator('[data-role="design-annotation"]')).toHaveCount(
      0
    )
  })

  test('03-locked-mobile: 375px white-label surface with touch tab-bar', async ({
    page,
  }) => {
    await page.goto(frameUrl('03-locked-mobile.html'))

    await expect(
      page.locator('body[data-frame="03-locked-mobile"]')
    ).toBeAttached()

    const phone = page.locator(
      '.phone[data-mode="locked"][data-viewport="375"][data-app="fuzesocial"]'
    )
    await expect(phone).toBeVisible()

    // The mobile canvas is 375px wide (the TWA viewport).
    const box = await phone.boundingBox()
    expect(box?.width).toBe(375)

    // Product brand + a bottom touch tab-bar with ≥4 tabs.
    await expect(phone.locator('.m-topbar .name')).toHaveText('FuzeSocial')
    const tabs = phone.locator('.m-tabbar .m-tab')
    expect(await tabs.count()).toBeGreaterThanOrEqual(4)

    // WHITE-LABEL INVARIANT.
    await expect(phone).not.toContainText('FuzeFront')
  })

  test('04-native-app-home: each product is its own installed app (distinct package id)', async ({
    page,
  }) => {
    await page.goto(frameUrl('04-native-app-home.html'))

    await expect(
      page.locator('body[data-frame="04-native-app-home"]')
    ).toBeAttached()

    // There is NO single container app.
    await expect(
      page.locator('.phone[data-container="absent"]')
    ).toBeVisible()

    // Multiple distinct installed apps, each with its own package id.
    const icons = page.locator('.grid .app-icon[data-packageid]')
    const count = await icons.count()
    expect(count).toBeGreaterThanOrEqual(3)

    const pkgs = await icons.evaluateAll(els =>
      els.map(e => e.getAttribute('data-packageid'))
    )
    // All package ids are present, non-empty, unique, and namespaced per product.
    expect(pkgs.every(p => !!p && p.startsWith('com.fuzefront.'))).toBe(true)
    expect(new Set(pkgs).size).toBe(pkgs.length)

    // FuzeSocial is one of them, with its expected package id.
    await expect(
      page.locator(
        '.app-icon[data-app="fuzesocial"][data-packageid="com.fuzefront.fuzesocial"]'
      )
    ).toBeVisible()
  })
})
