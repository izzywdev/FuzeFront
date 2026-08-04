// TypeID-compatible suffix codec: 128-bit UUID <-> 26-char base32.
//
// This is what lets the prefix be a WIRE concern while storage stays a native
// Postgres `uuid` column (16 bytes, and UUIDv7's leading timestamp gives the
// index locality a v4 PK throws away). The conversion is lossless in both
// directions, so `cus_01h455vb4pex5vsknk084sn02q` and
// `0195a8f2-...` are two renderings of one value — not two identifiers.
//
// Alphabet and layout follow the TypeID spec (Crockford base32, lowercase,
// no i/l/o/u). 26 chars x 5 bits = 130 bits, so the two most-significant bits
// are always zero and the first character never exceeds '7'.

import { randomUUID } from 'crypto'

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const SUFFIX_LENGTH = 26

/** Decode table; -1 marks a character outside the alphabet. */
const DECODE = (() => {
  const table = new Int8Array(128).fill(-1)
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i
  return table
})()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Encodes 16 bytes as the 26-character base32 suffix.
 *
 * Bit-packing note: `acc` never holds more than 20 bits (at most 12 carried
 * over, plus 8 shifted in), so it stays well inside the 32-bit range that
 * JavaScript bitwise operators coerce to. Starting `bits` at 2 supplies the
 * two zero bits that pad 128 up to 130.
 */
export function encodeSuffix(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new RangeError(`expected 16 bytes, received ${bytes.length}`)
  }
  let out = ''
  let acc = 0
  let bits = 2
  for (let i = 0; i < 16; i++) {
    acc = (acc << 8) | bytes[i]
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += ALPHABET[(acc >>> bits) & 31]
    }
  }
  return out
}

/** Decodes a 26-character base32 suffix back to 16 bytes. */
export function decodeSuffix(suffix: string): Uint8Array {
  if (suffix.length !== SUFFIX_LENGTH) {
    throw new RangeError(`suffix must be ${SUFFIX_LENGTH} characters, received ${suffix.length}`)
  }
  const bytes = new Uint8Array(16)
  let acc = 0
  let bits = 0
  let index = 0
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    const code = suffix.charCodeAt(i)
    const value = code < 128 ? DECODE[code] : -1
    if (value < 0) {
      throw new RangeError(`invalid base32 character ${JSON.stringify(suffix[i])} at position ${i}`)
    }
    if (i === 0) {
      // The leading character carries only 3 significant bits: encode pads 128
      // up to 130, so its top 2 bits are the padding and must be dropped here
      // or every subsequent byte lands two bits out of alignment. A value above
      // 7 means those pad bits were set, which encode can never produce.
      if (value > 7) throw new RangeError('suffix overflows 128 bits')
      acc = value & 7
      bits = 3
      continue
    }
    acc = (acc << 5) | value
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes[index++] = (acc >>> bits) & 0xff
    }
  }
  return bytes
}

export function isValidSuffix(suffix: string): boolean {
  try {
    decodeSuffix(suffix)
    return true
  } catch {
    return false
  }
}

/** Canonical hyphenated UUID string for 16 bytes. */
export function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_RE.test(uuid)) {
    throw new RangeError(`not a canonical UUID: ${JSON.stringify(uuid)}`)
  }
  const hex = uuid.replace(/-/g, '')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/**
 * Generates UUIDv7 bytes: 48-bit big-endian Unix-ms timestamp, 4-bit version,
 * 12 bits of randomness, 2-bit variant, then 62 more random bits (RFC 9562 §5.7).
 *
 * The leading timestamp is the point — ids minted near each other in time sort
 * near each other, so B-tree inserts stay clustered instead of scattering the
 * way v4 does.
 */
export function uuidv7Bytes(now: number = Date.now()): Uint8Array {
  // randomUUID() is a cheap, always-available CSPRNG source; we keep its random
  // bits and overwrite the timestamp, version and variant fields.
  const bytes = uuidToBytes(randomUUID())
  const ms = Math.floor(now)
  bytes[0] = (ms / 2 ** 40) & 0xff
  bytes[1] = (ms / 2 ** 32) & 0xff
  bytes[2] = (ms / 2 ** 24) & 0xff
  bytes[3] = (ms / 2 ** 16) & 0xff
  bytes[4] = (ms / 2 ** 8) & 0xff
  bytes[5] = ms & 0xff
  bytes[6] = 0x70 | (bytes[6] & 0x0f) // version 7
  bytes[8] = 0x80 | (bytes[8] & 0x3f) // RFC 9562 variant
  return bytes
}
