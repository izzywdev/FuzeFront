/**
 * Minimal, dependency-free RFC 6238 TOTP (SHA-1, 6 digits, 30s step).
 *
 * Used for the provider-agnostic `totp` MFA factor. Kept internal to the
 * concrete provider; the API surface never exposes anything but the neutral
 * `provisioningUri` + `secret` enrollment material.
 */
import crypto from 'crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Generate a random base32 TOTP secret. */
export function generateSecret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes)
  let bits = ''
  for (const b of buf) bits += b.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)]
  }
  return out
}

function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').toUpperCase().replace(/\s/g, '')
  let bits = ''
  for (const c of clean) {
    const idx = BASE32_ALPHABET.indexOf(c)
    if (idx === -1) continue
    bits += idx.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

function hotp(secret: string, counter: number, digits = 6): string {
  const key = base32Decode(secret)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (binary % 10 ** digits).toString().padStart(digits, '0')
}

/** Compute the current TOTP for a secret. */
export function generateToken(secret: string, forTime = Date.now(), step = 30): string {
  const counter = Math.floor(forTime / 1000 / step)
  return hotp(secret, counter)
}

/** Verify a code within ±`window` steps (clock skew tolerance). */
export function verifyToken(secret: string, token: string, forTime = Date.now(), window = 1, step = 30): boolean {
  if (!/^\d{6}$/.test(token)) return false
  const counter = Math.floor(forTime / 1000 / step)
  for (let i = -window; i <= window; i++) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(secret, counter + i)), Buffer.from(token))) {
      return true
    }
  }
  return false
}

/** Build an otpauth:// provisioning URI for QR rendering. */
export function provisioningUri(secret: string, label: string, issuer = 'FuzeFront'): string {
  const enc = encodeURIComponent
  return `otpauth://totp/${enc(issuer)}:${enc(label)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`
}
