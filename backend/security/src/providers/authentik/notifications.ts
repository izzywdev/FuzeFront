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
}

function smsServiceBase(): string {
  return (
    process.env.SMS_SERVICE_URL || 'http://sms-service:3000'
  ).replace(/\/$/, '')
}

function emailServiceBase(): string {
  return (
    process.env.EMAIL_SERVICE_URL || 'http://email-service:3000'
  ).replace(/\/$/, '')
}

async function postJson(url: string, body: unknown): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(`notification transport failure at ${url}: ${(err as Error).message}`)
  }
  return res
}

/** Default HTTP-backed client wiring the family sms/email services. */
export class HttpNotificationClient implements NotificationClient {
  async sendSmsOtp(phone: string): Promise<void> {
    const res = await postJson(`${smsServiceBase()}/send`, { to: phone })
    if (!res.ok) {
      throw new Error(`sms-service /send returned HTTP ${res.status}`)
    }
  }

  async checkSmsOtp(phone: string, code: string): Promise<boolean> {
    const res = await postJson(`${smsServiceBase()}/verify`, { to: phone, code })
    if (!res.ok) {
      // Fail-closed: any non-2xx means "not verified".
      return false
    }
    const body = (await res.json().catch(() => ({}))) as { verified?: boolean }
    return body.verified === true
  }

  async sendEmailVerification(email: string, token: string, code: string): Promise<void> {
    // email-service consumes an `email.requested` intent; we post it over HTTP.
    // Fail-closed on transport error so the caller can surface a 5xx.
    const res = await postJson(`${emailServiceBase()}/send`, {
      to: email,
      template: 'verify-email',
      data: { token, code },
    })
    if (!res.ok) {
      throw new Error(`email-service /send returned HTTP ${res.status}`)
    }
  }
}
