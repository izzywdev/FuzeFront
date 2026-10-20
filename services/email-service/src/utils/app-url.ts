/**
 * Public origin of the FuzeFront shell, used to build links in emails.
 *
 * `override` is the tenant origin supplied by security-service (taken from its
 * tenant registry, not client input; /send is bearer-guarded). It is still
 * re-validated here as an http(s) origin; anything else falls back to the
 * APP_BASE_URL env default.
 */
export function appBaseUrl(override?: unknown): string {
  if (typeof override === 'string' && override) {
    try {
      const u = new URL(override);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
    } catch {
      /* fall through to the default */
    }
  }
  return (process.env.APP_BASE_URL || 'https://app.fuzefront.com').replace(/\/+$/, '');
}
