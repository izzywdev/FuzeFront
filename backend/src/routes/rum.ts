// Browser RUM / client-log ingest (observability-standard P37).
//
//   POST /api/v1/rum   — body is the `RumPayload` that
//                        `@fuzefront/telemetry/browser`'s `initBrowserRum()`
//                        ships via navigator.sendBeacon (same-origin).
//
// What this route is and is not:
//  - It is a SINK, not an API for the app: always answers 204 for an accepted
//    payload and never blocks or fails the page on telemetry problems.
//  - Auth is OPTIONAL by design. An uncaught error during login, or a Web Vital
//    from the sign-in page, must still be reportable. Because the caller is
//    unauthenticated, nothing in the payload is trusted: it is size-bounded,
//    schema-validated, re-redacted, and only ever LOGGED — it never reaches a
//    database, a decision, or an identity claim. The session id is a client
//    correlation handle, not a credential.
//  - Abuse is bounded three ways: a per-IP rate limit, a hard body cap, and a
//    per-payload event cap (excess events are dropped, not errors).
//
// Events are emitted as structured pino logs (`source: "rum"`) so Loki can
// derive RED/Web-Vitals panels with LogQL and a log line links to its Tempo
// trace via `trace_id`. A Collector-side OTLP browser receiver is the
// FuzeInfra follow-up; until then logs are the durable sink.
import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { logger } from '../utils/logger'

const router = Router()

const MAX_EVENTS_PER_PAYLOAD = 50
const MAX_ATTRS_BYTES = 4096

// A flush is at most ~20 events every 10s per tab, plus pagehide. 120/min/IP is
// generous for a NAT'd office yet bounds a flood.
const rumRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many telemetry requests.' },
})

const TYPES = ['web-vital', 'navigation', 'resource', 'error', 'log'] as const

const eventSchema = z.object({
  type: z.enum(TYPES),
  ts: z.number().finite(),
  name: z.string().min(1).max(64),
  route: z.string().max(256).default('/'),
  message: z.string().max(1000).optional(),
  value: z.number().finite().optional(),
  attrs: z.record(z.unknown()).optional(),
  trace_id: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  span_id: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .optional(),
})

const payloadSchema = z.object({
  v: z.literal(1),
  service: z.string().min(1).max(64),
  release: z.string().max(64).default('unknown'),
  session_id: z.string().min(8).max(128),
  events: z.array(z.unknown()).max(500),
})

const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|credential|session[-_]?(id|token)|otp|\bcode\b|email|phone|card|ssn/i
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[REDACTED]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 [REDACTED]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED]'],
]

/** Defence in depth: the client already redacts, but the client is untrusted. */
function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return VALUE_PATTERNS.reduce((s, [re, rep]) => s.replace(re, rep), value)
  }
  if (value === null || typeof value !== 'object') return value
  if (depth >= 3) return '[Truncated]'
  if (Array.isArray(value)) return value.slice(0, 20).map(v => scrub(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : scrub(v, depth + 1)
  }
  return out
}

function levelFor(ev: z.infer<typeof eventSchema>): 'error' | 'warn' | 'info' | 'debug' {
  if (ev.type === 'error') return 'error'
  if (ev.type === 'log') {
    return ev.name === 'error' || ev.name === 'warn' || ev.name === 'debug' ? ev.name : 'info'
  }
  if (ev.type === 'resource' && (ev.attrs as { failed?: boolean } | undefined)?.failed) return 'warn'
  return 'info'
}

router.post('/', rumRateLimiter, (req: Request, res: Response) => {
  try {
    const payload = payloadSchema.safeParse(req.body)
    if (payload.success === false) {
      logger.debug({ issues: payload.error.issues.length }, 'rum: rejected malformed payload')
      return res.status(400).json({ error: 'Invalid telemetry payload' })
    }
    const { service, release, session_id, events } = payload.data

    let accepted = 0
    let rejected = 0
    for (const raw of events.slice(0, MAX_EVENTS_PER_PAYLOAD)) {
      const parsed = eventSchema.safeParse(raw)
      if (parsed.success === false) {
        rejected += 1
        continue
      }
      const ev = parsed.data
      let attrs = ev.attrs ? (scrub(ev.attrs) as Record<string, unknown>) : undefined
      if (attrs && JSON.stringify(attrs).length > MAX_ATTRS_BYTES) {
        attrs = { truncated: true }
      }
      accepted += 1
      logger[levelFor(ev)](
        {
          source: 'rum',
          rum: {
            type: ev.type,
            name: ev.name,
            route: ev.route,
            value: ev.value,
            clientTs: ev.ts,
            attrs,
          },
          clientService: service,
          release,
          session_id,
          ...(ev.trace_id ? { trace_id: ev.trace_id } : {}),
          ...(ev.span_id ? { span_id: ev.span_id } : {}),
        },
        ev.message ? String(scrub(ev.message)) : `rum ${ev.type} ${ev.name}`
      )
    }
    const dropped = Math.max(0, events.length - MAX_EVENTS_PER_PAYLOAD)
    if (rejected > 0 || dropped > 0) {
      logger.debug({ accepted, rejected, dropped }, 'rum: payload partially accepted')
    }
    return res.status(204).end()
  } catch (err) {
    // A telemetry sink must not 500 the browser into retry loops.
    logger.error({ err }, 'rum: ingest failed')
    return res.status(204).end()
  }
})

export default router
