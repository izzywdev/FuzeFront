/**
 * Escape characters that are special in HTML to prevent XSS.
 * Apply to every variable interpolated into an HTML email body or subject.
 */
export declare function escapeHtml(raw: string): string;
/** Fallback href used when a URL is invalid or has a disallowed scheme. */
export declare const SAFE_URL_FALLBACK = "https://app.fuzefront.com";
/**
 * Validate a URL string, reject dangerous schemes (javascript:, data:, …),
 * escape the result for safe use in an HTML attribute, and return the escaped
 * string.  Falls back to SAFE_URL_FALLBACK on any error.
 */
export declare function validateAndEscapeUrl(raw: string): string;
//# sourceMappingURL=html.d.ts.map