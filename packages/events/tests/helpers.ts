import { readFileSync } from 'fs'
import { join } from 'path'
import { buildEvent, type EnvelopeV2 } from '../src'

export function vectors<T = any>(file: string): T {
  return JSON.parse(readFileSync(join(__dirname, '../../conformance-vectors/events', file), 'utf8')) as T
}

export const ORG_A = 'org_01h455vb4pex5vsknk084sn02q'
export const ORG_B = 'org_01h455vb4pex5vsknk084sn03q'

export function ev(
  aggregateVersion: number,
  over: Partial<{ topic: string; aggregateId: string; payload: unknown; causationId: string }> = {}
): EnvelopeV2 {
  return buildEvent({
    topic: over.topic ?? 'identity.org.updated',
    aggregateType: 'organization',
    aggregateId: over.aggregateId ?? ORG_A,
    aggregateVersion,
    producer: 'security-service',
    payload: over.payload ?? { v: aggregateVersion },
    correlationId: 'corr-1',
    causationId: over.causationId,
  })
}

/** Envelope with a FIXED eventId (vectors pin ids). */
export function withId(e: EnvelopeV2, eventId: string): EnvelopeV2 {
  return { ...e, eventId }
}

/** `[name, case][]` for `it.each` from a vector file's `vectors`/`cases` array. */
export function cases(file: string, key: 'vectors' | 'cases'): Array<[string, any]> {
  return (vectors(file)[key] as any[]).map((c) => [c.name, c] as [string, any])
}
