/**
 * Notification delivery behind the identity adapter.
 *
 * SMS OTP is delivered by the family sms-service (Twilio Verify) and email
 * verification by the family email-service (SendGrid). Both are reached over
 * HTTP by Service DNS. The vendor is NEVER named on the Security API surface —
 * consumers see only neutral `type: 'sms' | 'email'` factors.
 *
 * These are injectable so unit tests can assert delivery without real network.
 */

export interface NotificationClient {
  /** Send an SMS OTP to an E.164 number. Delivery is provider-managed (Verify). */
  sendSmsOtp(phone: string): Promise<void>
  /** Check an SMS OTP against the delivery provider. Returns true when approved. */
  checkSmsOtp(phone: string, code: string): Promise<boolean>
  /** Send an email verification message (link or code) to an address. */
  sendEmailVerification(email: string, token: string, code: string): Promise<void>
  /** Send a self-service password-reset message carrying the single-use token. */
  sendPasswordReset(email: string, token: string): Promise<void>
}

function smsServiceBase(): string {
  return (
    process.env.SMS_SERVICE_URL || 'http://sms-service:3000'
  ).replace(/\/$/, '')
}

/**
 * Shared-secret bearer token the sms-service requires on every `/sms/*` route
 * (its `SMS_AUTH_SECRET`). Server-only; never inlined. Absent in unit tests /
 * inert mode — the request simply carries no Authorization header then.
 */
function smsServiceToken(): string | undefined {
  return process.env.SMS_SERVICE_TOKEN || process.env.SMS_AUTH_SECRET || undefined
}

function emailServiceBase(): string {
  return (
    process.env.EMAIL_SERVICE_URL || 'http://email-service:3000'
  ).replace(/\/$/, '')
}

function emailServiceToken(): string | undefined {
  return process.env.EMAIL_SERVICE_TOKEN || undefined
}

async function postJson(
  url: string,
  body: unknown,
  bearer?: string
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(`notification transport failure at ${url}: ${(err as Error).message}`)
  }
  return res
}

/**
 * Default HTTP-backed client wiring the family sms/email services.
 *
 * SMS OTP is delivered through the sms-service abstraction (Twilio Verify) — the
 * security service NEVER calls Twilio directly. The sms-service exposes
 * `POST /sms/send` and `POST /sms/verify`, both guarded by a shared-secret
 * bearer (`SMS_AUTH_SECRET`). Twilio Verify owns OTP generation/expiry/rate
 * limiting; we never roll our own OTP store.
 */
export class HttpNotificationClient implements NotificationClient {
  async sendSmsOtp(phone: string): Promise<void> {
    const res = await postJson(
      `${smsServiceBase()}/sms/send`,
      { to: phone },
      smsServiceToken()
    )
    if (!res.ok) {
      // Surfaces transport, auth (401), and rate-limit (429) failures so the
      // caller returns a 5xx/429 rather than silently claiming "sent".
      throw new Error(`sms-service /sms/send returned HTTP ${res.status}`)
    }
  }

  async checkSmsOtp(phone: string, code: string): Promise<boolean> {
    const res = await postJson(
      `${smsServiceBase()}/sms/verify`,
      { to: phone, code },
      smsServiceToken()
    )
    if (!res.ok) {
      // Fail-closed: any non-2xx (incl. 401/429) means "not verified".
      return false
    }
    const body = (await res.json().catch(() => ({}))) as { verified?: boolean }
    return body.verified === true
  }

  async sendEmailVerification(email: string, token: string, code: string): Promise<void> {
    // email-service consumes an `email.requested` intent; we post it over HTTP.
    // Fail-closed on transport error so the caller can surface a 5xx.
    const res = await postJson(
      `${emailServiceBase()}/send`,
      {
        to: email,
        template: 'verify-email',
        data: { token, code },
      },
      emailServiceToken()
    )
    if (!res.ok) {
      throw new Error(`email-service /send returned HTTP ${res.status}`)
    }
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    // Same `email.requested` intent as verification, different template. The raw
    // token leaves the service ONLY here — the DB holds just its SHA-256.
    const res = await postJson(
      `${emailServiceBase()}/send`,
      {
        to: email,
        template: 'password-reset',
        data: { token },
      },
      emailServiceToken()
    )
    if (!res.ok) {
      throw new Error(`email-service /send returned HTTP ${res.status}`)
    }
  }
}
