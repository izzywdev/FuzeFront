import { test, expect } from '@playwright/test'
import { seedMockSession } from '../../tests/support/account-vault'
import { loginSyntheticViaApi } from '../../tests/support/post-prod-auth'

/**
 * Deliberately opt-in production proof for the FuzePicker collaboration path.
 *
 * The sender uses the same authenticated API route as the Chrome extension.
 * A separate, controlled recipient mailbox then signs in to the FuzeFront
 * portal and the recording shows the received mention, its URL/XPath details,
 * and the reply control. The API queues the ZeptoMail notification addressed
 * to that mailbox; delivery to an external inbox is provider-asynchronous and
 * is therefore monitored by ZeptoMail rather than guessed from the HTTP 201.
 *
 * Required workflow secrets:
 *   POST_PROD_EMAIL / POST_PROD_PASSWORD (sender)
 *   POST_PROD_FUZEPICKER_RECIPIENT_EMAIL / _PASSWORD (controlled recipient)
 */

const senderEmail = process.env.POST_PROD_EMAIL || 'postprod-smoke@fuzefront.com'
const senderPassword = process.env.POST_PROD_PASSWORD
const recipientEmail = process.env.POST_PROD_FUZEPICKER_RECIPIENT_EMAIL
const recipientPassword = process.env.POST_PROD_FUZEPICKER_RECIPIENT_PASSWORD
const enabled = process.env.POST_PROD_RUN_FUZEPICKER_MENTION === 'true'

test.use({ video: 'on', trace: 'off', navigationTimeout: 30_000, actionTimeout: 20_000 })

test('FuzePicker mention is queued for email and visible to its recipient', async ({ page, request }, testInfo) => {
  test.skip(!enabled, 'Set run_fuzepicker_mention=true to intentionally create a production email mention.')
  expect(senderPassword, 'POST_PROD_PASSWORD is required for the mention sender').toBeTruthy()
  expect(recipientEmail, 'POST_PROD_FUZEPICKER_RECIPIENT_EMAIL must name a controlled mailbox').toBeTruthy()
  expect(recipientPassword, 'POST_PROD_FUZEPICKER_RECIPIENT_PASSWORD is required for the recipient portal session').toBeTruthy()

  const sender = await loginSyntheticViaApi(request, {
    email: senderEmail,
    password: senderPassword!,
    internalSecret: process.env.INTERNAL_PROVISION_SECRET,
    firstName: 'Post-prod',
    lastName: 'Mention sender',
  })
  const recipient = await loginSyntheticViaApi(request, {
    email: recipientEmail!,
    password: recipientPassword!,
    internalSecret: process.env.INTERNAL_PROVISION_SECRET,
    firstName: 'Post-prod',
    lastName: 'Mention recipient',
  })
  testInfo.annotations.push({ type: 'authentication', description: `sender via ${sender.via}; recipient via ${recipient.via}` })

  const marker = `Post-prod mention ${new Date().toISOString()}`
  const mentionResponse = await request.post('/api/fuzepicker/mentions', {
    headers: { Authorization: `Bearer ${sender.token}` },
    data: {
      recipientEmail,
      message: marker,
      pageUrl: 'https://fuzefront.com/',
      componentXPath: '/html[1]/body[1]/main[1]',
    },
  })
  expect(mentionResponse.status(), 'extension-compatible mention request must queue successfully').toBe(201)
  const { mention } = await mentionResponse.json() as { mention?: { id?: string; recipientEmail?: string } }
  expect(mention?.id, 'mention creation must return its durable ID').toBeTruthy()
  expect(mention?.recipientEmail).toBe(recipientEmail!.toLowerCase())
  testInfo.annotations.push({
    type: 'email',
    description: `ZeptoMail notification queued for ${recipientEmail} (mention ${mention?.id})`,
  })

  await page.addInitScript(seedMockSession, recipient.token)
  const failedRequests: string[] = []
  const pageErrors: string[] = []
  page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'failed'}`))
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/fuzepicker/mentions')
  await expect(page.getByRole('heading', { name: 'Mentions', exact: true })).toBeVisible()
  const mentionButton = page.getByRole('button', { name: marker, exact: true })
  await expect(mentionButton).toBeVisible({ timeout: 30_000 })
  await mentionButton.click()
  await expect(page.getByRole('region', { name: 'Mention details' })).toBeVisible()
  await expect(page.getByText('https://fuzefront.com/', { exact: true })).toBeVisible()
  await expect(page.locator('code')).toHaveText('/html[1]/body[1]/main[1]')
  await expect(page.getByLabel('Reply to sender')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open page', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('fuzepicker-mention-recipient.png'), fullPage: true })

  expect(pageErrors, `uncaught errors showing FuzePicker mention: ${pageErrors.join(' | ')}`).toEqual([])
  expect(failedRequests.filter(item => /fuzepicker|mentions/i.test(item)), `failed mention requests: ${failedRequests.join(' | ')}`).toEqual([])
})
