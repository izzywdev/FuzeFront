/**
 * dark.spec.ts — the flag-OFF ("dark") leg of the CI matrix.
 *
 * The on-path of selection-list-service is exercised by the full suite with the
 * offline OpenFeature provider forcing `fuzefront.selection-lists.service` ON
 * (FUZE_FLAGS_PROVIDER=offline). THIS spec runs the SAME service started with NO
 * flag provider at all — the exact fail-safe default an Unleash outage produces —
 * and proves the feature stays dark:
 *
 *   - POST /v1/selection-lists → 404 { code: 'NOT_FOUND' } (release flag OFF)
 *   - GET  /health            → 200 (liveness is never gated by the flag)
 *
 * This is intentionally NOT a `*.test.ts` file: the default jest testMatch skips
 * it, so it never runs on the ON leg (where it would wrongly expect 404). The
 * `off` leg runs it explicitly via `npm run test:dark` (jest.dark.config.ts).
 */
import { rawFetch, SERVICE_BASE_URL } from './helpers/client';
import { mintTestToken } from './helpers/auth';

const token = mintTestToken({
  userId: 'usr_01test0000000000000000dark',
  organizationId: 'org_01test0000000000000000dark',
});

describe('selection-list-service — flag OFF (dark)', () => {
  it('GET /health is 200 even while the feature is dark', async () => {
    const res = await fetch(`${SERVICE_BASE_URL}/health`);
    expect(res.status).toBe(200);
  });

  it('POST /v1/selection-lists is 404 NOT_FOUND while the release flag is OFF', async () => {
    const { status, body } = await rawFetch('/v1/selection-lists', {
      method: 'POST',
      token,
      body: JSON.stringify({ key: 'countries', name: 'Countries', source_locale: 'en' }),
    });
    expect(status).toBe(404);
    expect((body as { code?: string } | null)?.code).toBe('NOT_FOUND');
  });
});
