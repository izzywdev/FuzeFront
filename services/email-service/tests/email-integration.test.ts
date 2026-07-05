/**
 * Integration test: publish notify.email.requested -> Kafka -> email-service
 * -> SMTP -> MailHog, then assert via MailHog API.
 *
 * Prerequisites (docker-compose.test.yml must be running):
 *   KAFKA_BROKERS  defaults to localhost:9094
 *   MAILHOG_API    defaults to http://localhost:8025
 *
 * When the harness is NOT running, the test skips cleanly rather than
 * hanging for the full timeout.
 */
import { Kafka, logLevel } from 'kafkajs'
import { v4 as uuidv4 } from 'uuid'

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',')
const MAILHOG_API = process.env.MAILHOG_API || 'http://localhost:8025'
const TOPIC = 'notify.email.requested'

// ── helpers ─────────────────────────────────────────────────────────────────

async function pollMailhog(
  toAddress: string,
  correlationId: string,
  maxWaitMs = 20000,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILHOG_API}/api/v2/messages?limit=50`)
    if (!res.ok) throw new Error(`MailHog API ${res.status}`)
    const body = (await res.json()) as { items: Array<{ To: Array<{ Mailbox: string; Domain: string }>; Content: { Headers: { Subject: string[] } } }> }
    const match = body.items.find(
      (msg) =>
        msg.To.some(
          (addr) => `${addr.Mailbox}@${addr.Domain}` === toAddress,
        ),
    )
    if (match) {
      console.log('[mailhog] matched message subject:', match.Content.Headers.Subject)
      return true
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

async function isKafkaReachable(brokers: string[]): Promise<boolean> {
  const kafka = new Kafka({ brokers, logLevel: logLevel.NOTHING, connectionTimeout: 3000 })
  const admin = kafka.admin()
  try {
    await admin.connect()
    await admin.disconnect()
    return true
  } catch {
    return false
  }
}

async function isMailhogReachable(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/api/v2/messages?limit=1`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('email-service integration (requires docker-compose.test.yml)', () => {
  let skip = false

  beforeAll(async () => {
    const kafkaOk = await isKafkaReachable(KAFKA_BROKERS)
    const mailhogOk = await isMailhogReachable(MAILHOG_API)
    if (!kafkaOk || !mailhogOk) {
      const msg =
        `[email-integration] Harness not running (Kafka reachable: ${kafkaOk}, ` +
        `MailHog reachable: ${mailhogOk}).`
      if (process.env.CI) {
        // In CI the harness must be up — treat unreachability as a hard failure
        // so the job never silently passes with 0 assertions.
        throw new Error(`${msg} Refusing to skip in CI.`)
      }
      console.warn(`${msg} Tests will skip.`)
      skip = true
    }
  })

  test('publishes notify.email.requested and MailHog receives the message', async () => {
    if (skip) {
      console.log('[email-integration] SKIPPED (harness not up)')
      return
    }

    const correlationId = uuidv4()
    const toAddress = `test-${correlationId.slice(0, 8)}@fuzefront.test`

    // Clear MailHog inbox so old messages don't cause false positives
    await fetch(`${MAILHOG_API}/api/v1/messages`, { method: 'DELETE' })

    // Produce the Kafka event
    const kafka = new Kafka({ brokers: KAFKA_BROKERS, logLevel: logLevel.NOTHING })
    const producer = kafka.producer()
    await producer.connect()

    const event = {
      version: '1.0',
      topic: TOPIC,
      correlationId,
      occurredAt: new Date().toISOString(),
      payload: {
        to: toAddress,
        template: 'welcome',
        vars: { firstName: 'Integration', orgName: 'TestOrg', loginUrl: 'http://localhost' },
        correlationId,
      },
    }

    await producer.send({
      topic: TOPIC,
      messages: [{ key: correlationId, value: JSON.stringify(event) }],
    })
    await producer.disconnect()

    console.log('[email-integration] Published event correlationId:', correlationId, 'to:', toAddress)

    // Poll MailHog until the message appears (up to 20 s)
    const received = await pollMailhog(toAddress, correlationId, 20000)
    expect(received).toBe(true)
  })

  test('publishes org-invite template and MailHog receives it', async () => {
    if (skip) {
      console.log('[email-integration] SKIPPED (harness not up)')
      return
    }

    const correlationId = uuidv4()
    const toAddress = `invite-${correlationId.slice(0, 8)}@fuzefront.test`

    await fetch(`${MAILHOG_API}/api/v1/messages`, { method: 'DELETE' })

    const kafka = new Kafka({ brokers: KAFKA_BROKERS, logLevel: logLevel.NOTHING })
    const producer = kafka.producer()
    await producer.connect()

    const event = {
      version: '1.0',
      topic: TOPIC,
      correlationId,
      occurredAt: new Date().toISOString(),
      payload: {
        to: toAddress,
        template: 'org-invite',
        vars: {
          recipientName: 'Invited User',
          orgName: 'Test Org',
          inviterName: 'Admin',
          inviteUrl: 'http://localhost/invite/abc123',
          role: 'member',
        },
        correlationId,
      },
    }

    await producer.send({
      topic: TOPIC,
      messages: [{ key: correlationId, value: JSON.stringify(event) }],
    })
    await producer.disconnect()

    const received = await pollMailhog(toAddress, correlationId, 20000)
    expect(received).toBe(true)
  })
})
