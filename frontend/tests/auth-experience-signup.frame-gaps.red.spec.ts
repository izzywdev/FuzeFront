/**
 * AUTH EXPERIENCE SIGNUP — frame-completeness gaps (RED-by-design, deliberately NOT skipped).
 *
 * The signup QA brief enumerates the 06-states set that a complete signup design must cover:
 *   signup-initial, email-checking/taken/error, pw-weak inline + post-submit, confirm-mismatch,
 *   turnstile loading/READY/verified/failed, submit-inflight, signup-conflict (409),
 *   signup-service-unavailable (503) + Google fallback, RATE-LIMITED (429), form-error,
 *   mfa-required, unverified-gate.
 *
 * The APPROVED, frozen `06-states.html` (stamp 1bc0a7ab0347…) contains no `rate-limited`
 * card and no Turnstile `ready` (interactive challenge) card, although the contract has a
 * 429 RATE_LIMITED on POST /signup and the built SignUpFlow renders both states
 * (`[data-state='rate-limited']`, `[data-turnstile][data-state='ready']`). Per the frames'
 * own rule ("if it isn't a frame here, the implementation isn't required to handle it") the
 * design is incomplete for those two states: a designer must add them (a new frames PR,
 * re-approval) — QA must not edit the frozen frames.
 *
 * These specs go GREEN when `product-designer` adds the cards. Until then they are the
 * executable record of the gap. They live in a `.red.spec.ts` (repo convention) and are NOT
 * part of the root `-frames.spec.ts` merge gate.
 */
import { test, expect } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = fileURLToPath(new URL('.', import.meta.url))

const FRAME = pathToFileURL(
  path.resolve(HERE, '..', '..', 'design', 'frames', 'auth-experience', '06-states.html'),
).href

test.describe('06-states completeness vs the signup QA brief', () => {
  test.beforeEach(async ({ page }) => page.goto(FRAME))

  test('has a rate-limited (429 RATE_LIMITED on POST /signup) state card', async ({ page }) => {
    await expect(page.locator(".state-card[data-state='rate-limited']")).toBeVisible()
  })

  test('has a Turnstile READY (interactive challenge needed) state card', async ({ page }) => {
    await expect(
      page.locator(".state-card[data-state='turnstile-ready'], .state-card[data-state='turnstile-interactive']"),
    ).toBeVisible()
  })

  test('manifest 06-states testHooks list the rate-limited and turnstile-ready states', async () => {
    const manifest = (await import('node:fs')).readFileSync(
      path.resolve(HERE, '..', '..', 'design', 'frames', 'auth-experience', 'manifest.json'),
      'utf8',
    )
    expect(manifest).toContain("[data-state='rate-limited']")
    expect(manifest).toMatch(/\[data-state='turnstile-(ready|interactive)'\]/)
  })
})
