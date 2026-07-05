/**
 * Escape characters that are special in HTML to prevent XSS.
 * Apply to every variable interpolated into an HTML email body or subject.
 */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/** Allowlist of URL schemes that may appear in email hrefs. */
const ALLOWED_SCHEMES = new Set(['https:', 'http:']);

/** Fallback href used when a URL is invalid or has a disallowed scheme. */
export const SAFE_URL_FALLBACK = 'https://app.fuzefront.com';

/**
 * Validate a URL string, reject dangerous schemes (javascript:, data:, …),
 * escape the result for safe use in an HTML attribute, and return the escaped
 * string.  Falls back to SAFE_URL_FALLBACK on any error.
 */
export function validateAndEscapeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
      return escapeHtml(SAFE_URL_FALLBACK);
    }
    return escapeHtml(parsed.href);
  } catch {
    return escapeHtml(SAFE_URL_FALLBACK);
  }
}
