"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAndEscapeUrl = exports.SAFE_URL_FALLBACK = exports.escapeHtml = void 0;
/**
 * Escape characters that are special in HTML to prevent XSS.
 * Apply to every variable interpolated into an HTML email body or subject.
 */
function escapeHtml(raw) {
    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}
exports.escapeHtml = escapeHtml;
/** Allowlist of URL schemes that may appear in email hrefs. */
const ALLOWED_SCHEMES = new Set(['https:', 'http:']);
/** Fallback href used when a URL is invalid or has a disallowed scheme. */
exports.SAFE_URL_FALLBACK = 'https://app.fuzefront.com';
/**
 * Validate a URL string, reject dangerous schemes (javascript:, data:, …),
 * escape the result for safe use in an HTML attribute, and return the escaped
 * string.  Falls back to SAFE_URL_FALLBACK on any error.
 */
function validateAndEscapeUrl(raw) {
    try {
        const parsed = new URL(raw);
        if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
            return escapeHtml(exports.SAFE_URL_FALLBACK);
        }
        return escapeHtml(parsed.href);
    }
    catch {
        return escapeHtml(exports.SAFE_URL_FALLBACK);
    }
}
exports.validateAndEscapeUrl = validateAndEscapeUrl;
//# sourceMappingURL=html.js.map