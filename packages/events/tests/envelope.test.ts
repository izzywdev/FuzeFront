import { EnvelopeV2Schema, parseEnvelope } from '@fuzefront/shared/kafka'
import { buildEvent, validateEnvelope, EnvelopeValidationError } from '../src'
import { cases, ORG_A } from './helpers'

describe('buildEvent', () => {
  const base = {
    topic: 'identity.org.updated',
    aggregateType: 'organization',
    aggregateId: ORG_A,
    aggregateVersion: 3,
    producer: 'security-service',
    payload: { name: 'Acme' },
    correlationId: 'corr-1',
  }

  it('mints a valid evt_ TypeID and a contract-valid envelope', () => {
    const e = buildEvent(base)
    expect(e.eventId).toMatch(/^evt_[0-7][0-9a-hjkmnp-tv-z]{25}$/)
    expect(e.schemaVersion).toBe(1)
    expect(EnvelopeV2Schema.safeParse(e).success).toBe(true)
    expect(parseEnvelope(e)).toMatchObject({ success: true })
  })

  it('mints a distinct eventId per call (caller can never supply one)', () => {
    expect(buildEvent(base).eventId).not.toBe(buildEvent(base).eventId)
    expect((buildEvent({ ...base, ...({ eventId: 'evt_x' } as object) }) as any).eventId).not.toBe('evt_x')
  })

  it('carries causationId and omits it when absent', () => {
    const cause = buildEvent(base).eventId
    expect(buildEvent({ ...base, causationId: cause }).causationId).toBe(cause)
    expect('causationId' in buildEvent(base)).toBe(false)
  })

  it('accepts a Date occurredAt', () => {
    const e = buildEvent({ ...base, occurredAt: new Date('2026-10-05T12:00:00Z') })
    expect(e.occurredAt).toBe('2026-10-05T12:00:00.000Z')
  })

  it.each([
    ['bad topic', { topic: 'NoDots' }],
    ['version 0', { aggregateVersion: 0 }],
    ['bare-uuid aggregateId', { aggregateId: '0195a8f2-6c3d-7f11-8b2e-000000000000' }],
    ['empty producer', { producer: '' }],
    ['undefined payload', { payload: undefined }],
  ])('rejects %s', (_n, over) => {
    expect(() => buildEvent({ ...base, ...over } as any)).toThrow(EnvelopeValidationError)
  })
})

describe('conformance vectors: envelopes', () => {
  it.each(cases('envelopes.valid.json', 'vectors'))('valid: %s', (_n, v: any) => {
    expect(() => validateEnvelope(v.envelope)).not.toThrow()
  })
  it.each(cases('envelopes.invalid.json', 'vectors'))('invalid: %s', (_n, v: any) => {
    expect(() => validateEnvelope(v.envelope)).toThrow(EnvelopeValidationError)
  })
})
