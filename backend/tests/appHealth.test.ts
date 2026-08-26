/**
 * These tests exist to prove the health probe is NOT VACUOUS.
 *
 * The version this replaced returned `response.status < 500`, so a 404 counted
 * as healthy. A production probe of all 16 registered remotes found 0 serving a
 * module while the portal reported every one of them green. A test suite that
 * only asserted "a working app is healthy" would have passed against that code
 * too — so the weight here is on the cases that MUST report unhealthy.
 */
import { checkAppHealth, probeOrigin, ProbeableApp } from '../src/routes/appHealth'

const ORIGIN = 'https://app.example.test'

function mf(remote_url: string): ProbeableApp {
  return {
    name: 'demo',
    url: 'https://demo.example.test',
    integration_type: 'module-federation',
    remote_url,
  }
}

function iframe(url: string): ProbeableApp {
  return { name: 'demo', url, integration_type: 'iframe', remote_url: '' }
}

/** Stub global fetch with a fixed reply. Returns the URLs it was asked for. */
function stubFetch(
  reply: { status: number; contentType?: string; body?: string } | Error
) {
  const seen: string[] = []
  ;(global as any).fetch = jest.fn(async (url: string) => {
    seen.push(String(url))
    if (reply instanceof Error) throw reply
    return {
      status: reply.status,
      headers: {
        get: (h: string) =>
          h.toLowerCase() === 'content-type' ? (reply.contentType ?? '') : null,
      },
      text: async () => reply.body ?? '',
    }
  })
  return seen
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('checkAppHealth — the cases that must NOT be healthy', () => {
  it('reports a 404 remote entry as UNHEALTHY (the whole bug)', async () => {
    stubFetch({ status: 404, contentType: 'text/plain' })
    const r = await checkAppHealth(mf('/apps/demo/remoteEntry.js'), ORIGIN)
    expect(r.isHealthy).toBe(false)
    expect(r.httpStatus).toBe(404)
    expect(r.reason).toMatch(/nothing is mounted/i)
  })

  it('reports a 503 remote entry as UNHEALTHY and names it as a backend problem', async () => {
    stubFetch({ status: 503 })
    const r = await checkAppHealth(mf('/apps/demo/remoteEntry.js'), ORIGIN)
    expect(r.isHealthy).toBe(false)
    expect(r.httpStatus).toBe(503)
    expect(r.reason).toMatch(/no healthy backend/i)
  })

  it('reports 200 + HTML as UNHEALTHY — the SPA fallback "200 that isn\'t"', async () => {
    stubFetch({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body>portal shell</body></html>',
    })
    const r = await checkAppHealth(mf('/apps/demo/remoteEntry.js'), ORIGIN)
    expect(r.isHealthy).toBe(false)
    expect(r.httpStatus).toBe(200)
    expect(r.reason).toMatch(/SPA fallback/i)
  })

  it('reports 200 + HTML body as UNHEALTHY even when the content-type does not say html', async () => {
    stubFetch({
      status: 200,
      contentType: 'application/octet-stream',
      body: '  <!DOCTYPE html>\n<html></html>',
    })
    const r = await checkAppHealth(mf('/apps/demo/remoteEntry.js'), ORIGIN)
    expect(r.isHealthy).toBe(false)
    expect(r.reason).toMatch(/SPA fallback/i)
  })

  it('reports a module-federation app with no remote_url as UNHEALTHY', async () => {
    stubFetch({ status: 200, contentType: 'application/javascript' })
    const r = await checkAppHealth(mf(''), ORIGIN)
    expect(r.isHealthy).toBe(false)
    expect(r.reason).toMatch(/no remote_url/i)
  })

  it('reports a network failure as UNHEALTHY and names the error', async () => {
    stubFetch(new Error('ECONNREFUSED'))
    const r = await checkAppHealth(mf('/apps/demo/remoteEntry.js'), ORIGIN)
    expect(r.isHealthy).toBe(false)
    expect(r.httpStatus).toBeNull()
    expect(r.reason).toMatch(/ECONNREFUSED/)
  })

  it('reports a 404 on a NON-federated app root as UNHEALTHY (was < 500 before)', async () => {
    stubFetch({ status: 404 })
    const r = await checkAppHealth(iframe('https://demo.example.test'), ORIGIN)
    expect(r.isHealthy).toBe(false)
    expect(r.httpStatus).toBe(404)
  })
})

describe('checkAppHealth — the cases that must be healthy', () => {
  it('accepts 200 + a JavaScript content-type', async () => {
    stubFetch({ status: 200, contentType: 'application/javascript' })
    const r = await checkAppHealth(mf('/apps/demo/remoteEntry.js'), ORIGIN)
    expect(r.isHealthy).toBe(true)
    expect(r.reason).toBeNull()
  })

  it('does NOT download the bundle when the content-type already settles it', async () => {
    const textSpy = jest.fn(async () => 'x'.repeat(1_000_000))
    ;(global as any).fetch = jest.fn(async () => ({
      status: 200,
      headers: { get: () => 'text/javascript' },
      text: textSpy,
    }))
    const r = await checkAppHealth(mf('/apps/demo/remoteEntry.js'), ORIGIN)
    expect(r.isHealthy).toBe(true)
    expect(textSpy).not.toHaveBeenCalled()
  })

  it('accepts a 2xx/3xx root for a non-federated app', async () => {
    stubFetch({ status: 302 })
    const r = await checkAppHealth(iframe('https://demo.example.test'), ORIGIN)
    expect(r.isHealthy).toBe(true)
  })
})

describe('remote_url resolution', () => {
  it('resolves a relative remote_url against the portal origin', async () => {
    const seen = stubFetch({ status: 200, contentType: 'application/javascript' })
    await checkAppHealth(mf('/apps/demo/remoteEntry.js'), ORIGIN)
    expect(seen[0]).toBe(`${ORIGIN}/apps/demo/remoteEntry.js`)
  })

  it('probes an ABSOLUTE remote_url verbatim, not against the portal origin', async () => {
    // A cross-origin registration must be judged on the host it names. Probing
    // it same-origin would report a 404 for a path the app never claimed —
    // which is exactly how the first production probe mis-scored fuzekeys.
    const seen = stubFetch({ status: 200, contentType: 'application/javascript' })
    await checkAppHealth(
      mf('https://keys.example.test/apps/demo/remoteEntry.js'),
      ORIGIN
    )
    expect(seen[0]).toBe('https://keys.example.test/apps/demo/remoteEntry.js')
  })
})

describe('probeOrigin', () => {
  it('prefers an explicit FEDERATION_PROBE_ORIGIN', () => {
    const prev = process.env.FEDERATION_PROBE_ORIGIN
    process.env.FEDERATION_PROBE_ORIGIN = 'https://configured.example.test/'
    expect(probeOrigin({ headers: { host: 'ignored' } })).toBe(
      'https://configured.example.test'
    )
    if (prev === undefined) delete process.env.FEDERATION_PROBE_ORIGIN
    else process.env.FEDERATION_PROBE_ORIGIN = prev
  })

  it('IGNORES caller-controlled headers and returns empty when unconfigured', () => {
    // The security property under test. probeOrigin used to fall back to
    // x-forwarded-host / Host, which let whoever sent the request choose the
    // origin this server probes — and therefore choose the health every app
    // reports. Asserting the headers are ignored is the only way this stays
    // true: the previous implementation passed a test that asserted the
    // opposite, so a "does it work" test would have agreed with the bug.
    const prev = process.env.FEDERATION_PROBE_ORIGIN
    delete process.env.FEDERATION_PROBE_ORIGIN
    expect(
      probeOrigin({
        protocol: 'http',
        headers: {
          host: 'attacker.example.test',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'attacker.example.test',
        },
      })
    ).toBe('')
    if (prev !== undefined) process.env.FEDERATION_PROBE_ORIGIN = prev
  })

  it('strips a trailing slash from the configured origin', () => {
    const prev = process.env.FEDERATION_PROBE_ORIGIN
    process.env.FEDERATION_PROBE_ORIGIN = 'https://app.fuzefront.com//'
    expect(probeOrigin({})).toBe('https://app.fuzefront.com')
    if (prev === undefined) delete process.env.FEDERATION_PROBE_ORIGIN
    else process.env.FEDERATION_PROBE_ORIGIN = prev
  })
})

describe('fail-closed when the origin is unconfigured', () => {
  it('reports a same-origin remote_url as UNHEALTHY, naming the missing config', async () => {
    const seen = stubFetch({ status: 200, contentType: 'application/javascript' })
    const r = await checkAppHealth(mf('/apps/demo/remoteEntry.js'), '')
    expect(r.isHealthy).toBe(false)
    expect(r.httpStatus).toBeNull()
    expect(r.reason).toMatch(/FEDERATION_PROBE_ORIGIN is not set/i)
    // and it must not have probed anything at all
    expect(seen).toHaveLength(0)
  })

  it('still probes an ABSOLUTE remote_url with no configured origin', async () => {
    // An absolute entry names its own host, so no origin is needed and there is
    // nothing for a header to influence. Failing closed here would be
    // over-correction, turning a working check off.
    const seen = stubFetch({ status: 200, contentType: 'application/javascript' })
    const r = await checkAppHealth(
      mf('https://keys.example.test/apps/demo/remoteEntry.js'),
      ''
    )
    expect(r.isHealthy).toBe(true)
    expect(seen[0]).toBe('https://keys.example.test/apps/demo/remoteEntry.js')
  })

  it('does not affect non-federated apps, which probe their own absolute url', async () => {
    const seen = stubFetch({ status: 200 })
    const r = await checkAppHealth(iframe('https://demo.example.test'), '')
    expect(r.isHealthy).toBe(true)
    expect(seen[0]).toBe('https://demo.example.test')
  })
})
