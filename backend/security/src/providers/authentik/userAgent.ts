/**
 * Minimal, dependency-free user-agent parsing for the manage-devices list.
 *
 * Scope is deliberately narrow: the `SessionDevice` contract types device /
 * browser / os as nullable, best-effort display hints — they are shown to a
 * human deciding "is this me?", never used for any security decision. So an
 * unrecognised agent correctly yields nulls rather than a guess.
 *
 * No UA-parsing library is pulled in: those ship large, frequently-updated
 * regex corpora to answer questions we do not ask (bot detection, engine
 * versions, device models). Order matters below — several families spoof each
 * other's tokens (every Chromium browser says "Chrome"; Edge/Opera say both),
 * so the most specific brand must be tested first.
 */

export interface ParsedUserAgent {
  device: string | null
  browser: string | null
  os: string | null
}

const EMPTY: ParsedUserAgent = { device: null, browser: null, os: null }

/** Browser brands, MOST SPECIFIC FIRST (Chromium forks all claim "Chrome"). */
const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdgA?\/|\bEdge\//i, 'Edge'],
  [/\bOPR\/|\bOpera\//i, 'Opera'],
  [/\bSamsungBrowser\//i, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//i, 'Firefox'],
  [/\bChrome\/|\bCriOS\//i, 'Chrome'],
  // Safari must come last: every WebKit browser carries a "Safari/" token.
  [/\bSafari\//i, 'Safari'],
]

/** OS families, most specific first (Android must precede Linux). */
const OSES: Array<[RegExp, string]> = [
  [/\bWindows NT\b|\bWindows\b/i, 'Windows'],
  [/\bAndroid\b/i, 'Android'],
  [/\biPhone\b|\biPad\b|\biPod\b|\biOS\b/i, 'iOS'],
  [/\bMac OS X\b|\bMacintosh\b/i, 'macOS'],
  [/\bCrOS\b/i, 'ChromeOS'],
  [/\bLinux\b|\bX11\b/i, 'Linux'],
]

/**
 * Derive a coarse device class. Only the distinction a user actually needs to
 * recognise a session ("my phone" vs "my laptop") — never a device model.
 */
function device(ua: string): string | null {
  if (/\biPad\b/i.test(ua)) return 'Tablet'
  if (/\biPhone\b|\biPod\b/i.test(ua)) return 'iPhone'
  // Android encodes form factor by the presence of "Mobile": Android + Mobile
  // is a phone, Android without it is a tablet.
  if (/\bAndroid\b/i.test(ua)) return /\bMobile\b/i.test(ua) ? 'Phone' : 'Tablet'
  if (/\bMobile\b/i.test(ua)) return 'Phone'
  if (/\bWindows\b|\bMacintosh\b|\bMac OS X\b|\bCrOS\b|\bLinux\b|\bX11\b/i.test(ua)) return 'Desktop'
  return null
}

function firstMatch(ua: string, table: Array<[RegExp, string]>): string | null {
  for (const [re, name] of table) if (re.test(ua)) return name
  return null
}

/**
 * Parse a stored user-agent string. Returns all-nulls for absent/blank/unknown
 * agents — the contract permits nulls, so we never fabricate a value.
 */
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  if (!ua || typeof ua !== 'string' || !ua.trim()) return { ...EMPTY }
  return {
    device: device(ua),
    browser: firstMatch(ua, BROWSERS),
    os: firstMatch(ua, OSES),
  }
}
