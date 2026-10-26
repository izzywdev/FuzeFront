import { test, expect } from '@playwright/test'
import { ImapFlow } from 'imapflow'
import { seedMockSession } from '../../tests/support/account-vault'
import { loginSyntheticViaApi } from '../../tests/support/post-prod-auth'

/**
 * Deliberately opt-in production proof for the FuzePicker collaboration path.
 *
 * The sender uses the same authenticated API route as the Chrome extension.
 * A separate, controlled recipient mailbox then signs in to the FuzeFront
 * portal and the recording shows the received mention, its URL/XPath details,
 * and the reply control. Before opening the portal it polls the controlled
 * Zoho inbox over IMAP for the exact marker, so a 201 only passes after the
 * real ZeptoMail message has arrived.
 *
 * Required workflow secrets:
 *   POST_PROD_EMAIL / POST_PROD_PASSWORD (sender)
 *   POST_PROD_TEST_RECIPIENT_PASSWORD (FuzeFront recipient account)
 *   POST_PROD_TEST_RECIPIENT_ZOHO_APP_PASSWORD (Zoho IMAP app password)
 */

const senderEmail = process.env.POST_PROD_EMAIL || 'postprod-smoke@fuzefront.com'
const senderPassword = process.env.POST_PROD_PASSWORD
const recipientEmail = process.env.POST_PROD_TEST_RECIPIENT_EMAIL || 'tests@fuzefront.com'
const recipientPassword = process.env.POST_PROD_TEST_RECIPIENT_PASSWORD
const zohoAppPassword = process.env.POST_PROD_TEST_RECIPIENT_ZOHO_APP_PASSWORD
const enabled = process.env.POST_PROD_RUN_FUZEPICKER_MENTION === 'true'

test.use({ video: 'on', trace: 'off', navigationTimeout: 30_000, actionTimeout: 20_000 })

async function waitForZohoMention(marker: string): Promise<string> {
  const client = new ImapFlow({
    host: process.env.POST_PROD_TEST_RECIPIENT_IMAP_HOST || 'imap.zoho.com',
    port: 993,
    secure: true,
    auth: { user: recipientEmail, pass: zohoAppPassword! },
    logger: false,
  })
  try {
    await client.connect()
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      const lock = await client.getMailboxLock('INBOX')
      try {
        const first = Math.max(1, (client.mailbox.exists || 1) - 24)
        for await (const email of client.fetch(`${first}:*`, { envelope: true, source: true })) {
          const source = Buffer.isBuffer(email.source) ? email.source.toString('utf8') : ''
          if (source.includes(marker)) return email.envelope.subject || 'FuzePicker mention'
        }
      } finally {
        lock.release()
      }
      await new Promise(resolve => setTimeout(resolve, 5_000))
    }
    throw new Error('Timed out waiting for the FuzePicker mention in the Zoho INBOX')
  } finally {
    await client.logout().catch(() => undefined)
  }
}

test('FuzePicker mention is queued for email and visible to its recipient', async ({ page, request }, testInfo) => {
  test.setTimeout(180_000)
  test.skip(!enabled, 'Set run_fuzepicker_mention=true to intentionally create a production email mention.')
  expect(senderPassword, 'POST_PROD_PASSWORD is required for the mention sender').toBeTruthy()
  expect(recipientPassword, 'POST_PROD_TEST_RECIPIENT_PASSWORD is required for the recipient portal session').toBeTruthy()
  expect(zohoAppPassword, 'POST_PROD_TEST_RECIPIENT_ZOHO_APP_PASSWORD is required to verify inbox delivery').toBeTruthy()

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
  expect(mention?.recipientEmail).toBe(recipientEmail.toLowerCase())
  const subject = await waitForZohoMention(marker)
  expect(subject).toMatch(/mentioned you in FuzePicker/i)
  testInfo.annotations.push({
    type: 'email',
    description: `ZeptoMail mention ${mention?.id} verified in the controlled Zoho inbox`,
  })

  // Keep mailbox evidence in the recording without displaying a deep link or
  // message body, either of which could contain an invite token.
  await page.setContent('<main><h1>Zoho delivery verified</h1><p>The FuzePicker mention arrived in the controlled mailbox.</p></main>')
  await expect(page.getByRole('heading', { name: 'Zoho delivery verified' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('zoho-delivery-verified.png') })

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
