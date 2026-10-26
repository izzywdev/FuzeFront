/**
 * Where the harness reaches the stand-in Security API (helpers/fake-security-api.mjs) to post fixtures
 * (`/__fixture/*`), mint a machine token for the support path, or read grants back.
 *
 * It MUST be the same server the service under test authorizes against, or a fixture lands on a stand-in the
 * service never consults and the test passes or fails for the wrong reason. The service is pointed at its
 * Security API with `SECURITY_SERVICE_URL`, so that is the default here; `FAKE_SECURITY_URL` overrides it
 * only when set explicitly (e.g. the harness reaches the stand-in at an address the service cannot use).
 * With neither set it is `http://localhost:3002`, the port `fake-security-api.mjs` listens on by default.
 *
 * The value is resolved ONCE, when this module is first imported. contract/seeding.test.ts later repoints
 * `SECURITY_SERVICE_URL` at its own in-process token-introspection server (for the service-side attestation
 * it drives); the stand-in is still the server its fixtures and support-path grants must reach, so a lazy
 * read here would send them to the wrong place.
 *
 * Every helper or test that talks to the stand-in imports this constant - never re-reads the environment.
 */
const trimmed = (v: string | undefined): string | undefined => {
  const t = v?.trim().replace(/\/+$/, '');
  return t ? t : undefined;
};

export const FAKE_SECURITY_URL: string =
  trimmed(process.env['FAKE_SECURITY_URL']) ?? trimmed(process.env['SECURITY_SERVICE_URL']) ?? 'http://localhost:3002';
