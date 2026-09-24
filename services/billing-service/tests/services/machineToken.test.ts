import { getMachineToken, _resetMachineTokenCacheForTesting, MachineTokenConfig } from '../../src/services/machineToken';

const CONFIG: MachineTokenConfig = {
  tokenUrl: 'https://auth.example.test/application/o/s2s-billing-service/token/',
  clientId: 'billing-service',
  clientSecret: 'shh',
};

function makeFetch(response: { ok: boolean; status?: number; json?: any; text?: string }) {
  return jest.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    statusText: 'error',
    json: async () => response.json,
    text: async () => response.text ?? '',
  });
}

describe('getMachineToken', () => {
  beforeEach(() => {
    _resetMachineTokenCacheForTesting();
  });

  it('performs a client_credentials POST and returns the access token', async () => {
    const fetchImpl = makeFetch({ ok: true, json: { access_token: 'tok-abc', expires_in: 3600 } });

    const token = await getMachineToken(CONFIG, fetchImpl as any);

    expect(token).toBe('tok-abc');
    expect(fetchImpl).toHaveBeenCalledWith(
      CONFIG.tokenUrl,
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
    );
    const body = (fetchImpl.mock.calls[0][1] as any).body as string;
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('client_id=billing-service');
  });

  it('caches the token across calls until near expiry', async () => {
    const fetchImpl = makeFetch({ ok: true, json: { access_token: 'tok-cached', expires_in: 3600 } });

    const t1 = await getMachineToken(CONFIG, fetchImpl as any);
    const t2 = await getMachineToken(CONFIG, fetchImpl as any);

    expect(t1).toBe('tok-cached');
    expect(t2).toBe('tok-cached');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws on a non-2xx response (never resolves on failure)', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 401, text: 'invalid_client' });

    await expect(getMachineToken(CONFIG, fetchImpl as any)).rejects.toThrow(/401/);
  });

  it('throws when config is incomplete', async () => {
    await expect(
      getMachineToken({ tokenUrl: '', clientId: '', clientSecret: '' }, jest.fn() as any),
    ).rejects.toThrow(/not fully configured/);
  });
});
