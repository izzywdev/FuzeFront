import {
  bytesToUuid,
  decodeSuffix,
  encodeSuffix,
  uuidToBytes,
  uuidv7Bytes,
} from '../src/codec'
import {
  assertRef,
  configureIdentity,
  entityTypeOf,
  fromUuid,
  isId,
  mintId,
  parseId,
  toUuid,
  tryParseId,
} from '../src/id'
import { IdentityError } from '../src/brand'
import type { EntityId } from '../src/brand'
import { ENTITY_PREFIXES, ENTITY_TYPES } from '../src/registry'
import type { EntityType } from '../src/registry'

beforeEach(() => {
  configureIdentity({ legacyUuidTypes: new Set<EntityType>() })
})

describe('codec — TypeID spec conformance', () => {
  // Vectors from the TypeID spec's valid.yml. These pin the wire format: if
  // they ever change, every stored reference in the family is invalidated.
  const VECTORS: Array<[string, string]> = [
    ['00000000-0000-0000-0000-000000000000', '00000000000000000000000000'],
    ['01890a5d-ac96-774b-bcce-b302099a8057', '01h455vb4pex5vsknk084sn02q'],
    ['0110c853-1d09-52d8-d73e-1194e95b5f19', '0123456789abcdefghjkmnpqrs'],
    ['ffffffff-ffff-ffff-ffff-ffffffffffff', '7zzzzzzzzzzzzzzzzzzzzzzzzz'],
  ]

  it.each(VECTORS)('encodes %s', (uuid, expected) => {
    expect(encodeSuffix(uuidToBytes(uuid))).toBe(expected)
  })

  it.each(VECTORS)('decodes back to %s', (uuid, suffix) => {
    expect(bytesToUuid(decodeSuffix(suffix))).toBe(uuid)
  })

  it('round-trips arbitrary UUIDs', () => {
    for (let i = 0; i < 2000; i++) {
      const id = mintId('customer')
      expect(fromUuid('customer', toUuid(id))).toBe(id)
    }
  })

  it('rejects characters outside the alphabet', () => {
    // i, l, o and u are excluded to avoid transcription ambiguity.
    expect(() => decodeSuffix('0li00000000000000000000000')).toThrow(/invalid base32/)
  })

  it('rejects a suffix that overflows 128 bits', () => {
    expect(() => decodeSuffix('8zzzzzzzzzzzzzzzzzzzzzzzzz')).toThrow(/overflows/)
  })

  it('rejects a wrong-length suffix', () => {
    expect(() => decodeSuffix('0123')).toThrow(/26 characters/)
  })
})

describe('uuidv7', () => {
  it('sets version 7 and the RFC 9562 variant', () => {
    const bytes = uuidv7Bytes()
    expect(bytes[6] & 0xf0).toBe(0x70)
    expect(bytes[8] & 0xc0).toBe(0x80)
  })

  it('encodes the supplied timestamp big-endian in the leading 48 bits', () => {
    const now = 0x0123456789ab
    const bytes = uuidv7Bytes(now)
    expect(Array.from(bytes.slice(0, 6))).toEqual([0x01, 0x23, 0x45, 0x67, 0x89, 0xab])
  })

  it('is k-sortable — later ids sort after earlier ones', () => {
    const early = `${ENTITY_PREFIXES.customer}_${encodeSuffix(uuidv7Bytes(1_000_000))}`
    const late = `${ENTITY_PREFIXES.customer}_${encodeSuffix(uuidv7Bytes(2_000_000))}`
    expect(early < late).toBe(true)
  })
})

describe('mintId', () => {
  it('prefixes with the registered prefix for the type', () => {
    expect(mintId('customer')).toMatch(/^cus_[0-9a-hjkmnp-tv-z]{26}$/)
    expect(mintId('invoice')).toMatch(/^inv_/)
  })

  it('mints a distinct id every time', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => mintId('payment')))
    expect(seen.size).toBe(1000)
  })

  it('covers every registered entity type', () => {
    for (const type of ENTITY_TYPES) {
      expect(parseId(type, mintId(type))).toBeDefined()
    }
  })
})

describe('parseId / assertRef — the type-confusion defense', () => {
  it('accepts an id of the expected type', () => {
    const id = mintId('customer')
    expect(parseId('customer', id)).toBe(id)
  })

  it('REJECTS an id belonging to a different entity type', () => {
    // The whole point of the standard: a customer id presented where an
    // invoice id is expected must not resolve.
    const customer = mintId('customer')
    expect(() => parseId('invoice', customer)).toThrow(IdentityError)
    try {
      parseId('invoice', customer)
    } catch (err) {
      expect((err as IdentityError).code).toBe('PREFIX_MISMATCH')
      expect((err as IdentityError).message).toMatch(/expected a invoice id/)
    }
  })

  it('names the actual type in the error, to make the 422 actionable', () => {
    expect(() => parseId('invoice', mintId('customer'))).toThrow(/received a customer id/)
  })

  it('rejects an unregistered prefix', () => {
    expect(() => parseId('customer', 'zzz_01h455vb4pex5vsknk084sn02q')).toThrow(/unregistered prefix/)
  })

  it('rejects a malformed suffix', () => {
    expect(() => parseId('customer', 'cus_notavalidsuffix')).toThrow(/malformed suffix/)
  })

  it('rejects non-strings', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(() => parseId('customer', bad)).toThrow(IdentityError)
    }
  })

  it('rejects a bare UUID by default — strict unless explicitly configured', () => {
    expect(() => parseId('customer', '01890a5d-ac96-774b-bcce-b302099a8057')).toThrow(
      /prefixed ids are required/
    )
  })

  it('accepts a bare UUID only for a type inside its dual-accept window', () => {
    configureIdentity({ legacyUuidTypes: new Set<EntityType>(['customer']) })
    const legacy = '01890a5d-ac96-774b-bcce-b302099a8057'
    expect(parseId('customer', legacy)).toBe(legacy)
    // ...and the window is per-type, not global.
    expect(() => parseId('invoice', legacy)).toThrow(/prefixed ids are required/)
  })

  it('assertRef is parseId — the L0 referential check', () => {
    const id = mintId('customer')
    expect(assertRef('customer', id)).toBe(id)
    expect(() => assertRef('customer', mintId('invoice'))).toThrow(IdentityError)
  })

  it('tryParseId and isId report instead of throwing', () => {
    expect(tryParseId('customer', mintId('invoice'))).toBeNull()
    expect(isId('customer', mintId('customer'))).toBe(true)
    expect(isId('customer', 'nonsense')).toBe(false)
  })
})

describe('storage <-> wire conversion', () => {
  it('toUuid produces a canonical UUID suitable for a uuid column', () => {
    const uuid = toUuid(mintId('customer'))
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('fromUuid is the exact inverse of toUuid', () => {
    const id = mintId('subscription')
    expect(fromUuid('subscription', toUuid(id))).toBe(id)
  })

  it('passes a legacy bare UUID through toUuid unchanged', () => {
    configureIdentity({ legacyUuidTypes: new Set<EntityType>(['portal']) })
    const legacy = parseId('portal', '01890a5d-ac96-774b-bcce-b302099a8057')
    expect(toUuid(legacy)).toBe('01890a5d-ac96-774b-bcce-b302099a8057')
  })
})

describe('entityTypeOf', () => {
  it('reports the type an id declares itself to be', () => {
    expect(entityTypeOf(mintId('invoice'))).toBe('invoice')
    expect(entityTypeOf('zzz_01h455vb4pex5vsknk084sn02q')).toBeNull()
    expect(entityTypeOf('not-an-id')).toBeNull()
  })
})

describe('the compile-time guarantee', () => {
  it('will not accept a raw string where a typed id is required', () => {
    const takesCustomer = (id: EntityId<'customer'>): string => id

    // @ts-expect-error a bare string off req.body is not a validated customer id
    takesCustomer('cus_01h455vb4pex5vsknk084sn02q')

    // @ts-expect-error an invoice id is not a customer id, even though both are strings
    takesCustomer(mintId('invoice'))

    // The sanctioned constructors do type-check.
    expect(takesCustomer(mintId('customer'))).toBeDefined()
    expect(takesCustomer(parseId('customer', mintId('customer')))).toBeDefined()
  })
})
