import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'

const script = path.resolve(__dirname, '../../deploy/e2e/provision-authentik-oidc.sh')

describe('Authentik E2E provider grant reconciliation', () => {
  let directory: string
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'authentik-grants-'))
    writeFileSync(path.join(directory, 'docker'), '#!/bin/bash\ncat >/dev/null\nprintf "FLOW_SOURCE=builtin\\nFLOW_PK=test-flow\\n"\n', { mode: 0o755 })
    writeFileSync(path.join(directory, 'curl'), `#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
url = next((a for a in args if a.startswith('http')), '')
if '-X' in args and args[args.index('-X') + 1] == 'PATCH':
    payload = json.loads(args[args.index('-d') + 1])
    assert payload == {'authorization_flow': 'test-flow', 'grant_types': ['authorization_code', 'refresh_token']}
    print(os.environ.get('PATCH_HTTP', '200'), end='')
elif 'core/applications/?' in url:
    print(json.dumps({'results': [{'slug': 'fuzefront'}]}))
elif 'providers/oauth2/?' in url:
    print(json.dumps({'results': [{'name': 'FuzeFront', 'pk': 42}]}))
elif 'providers/oauth2/42/' in url:
    print(json.dumps({'authorization_flow': 'test-flow', 'grant_types': [] if os.environ.get('MISSING_GRANTS') else ['authorization_code', 'refresh_token']}))
elif 'openid-configuration' in url:
    print('{}')
else:
    raise SystemExit('Unexpected provisioning call')
`, { mode: 0o755 })
  })
  afterEach(() => rmSync(directory, { recursive: true, force: true }))
  function run(extra: Record<string, string> = {}) {
    return spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, ...extra } })
  }
  it('repairs an existing provider instead of treating discovery as readiness', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('browser grant types verified')
  })
  it('fails on rejected configuration without proceeding to discovery', () => {
    const result = run({ PATCH_HTTP: '400' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Failed to configure provider')
    expect(result.stdout).not.toContain('OIDC discovery available')
  })
  it('fails when the API does not persist the required browser grants', () => {
    const result = run({ MISSING_GRANTS: '1' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('grant types did not persist')
  })
  it('validates shell syntax', () => {
    expect(() => execFileSync('bash', ['-n', script])).not.toThrow()
  })
})
