/**
 * s2s-credentials-file.test.ts
 *
 * Unit tests for register-s2s-cli.ts's argv parsing and credential-file writer
 * (backend/src/authentik/s2s-credentials-file.ts).
 *
 * WHY THESE MATTER. The file this writer produces is consumed verbatim by
 * `kubectl create secret generic --from-env-file` in
 * deploy/helm/fuzefront/templates/billing-s2s-register-job.yaml, so it IS the
 * Secret's contents. A malformed line does not fail loudly there — it produces a
 * Secret with a missing or truncated key, which surfaces much later as an opaque
 * 401 from Authentik's token endpoint. The assertions in the writer are the only
 * thing standing between a bad credential and that debugging session, so they
 * are tested rather than assumed.
 */

import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseArgs,
  writeCredentialsEnvFile,
} from '../src/authentik/s2s-credentials-file'

describe('parseArgs', () => {
  it('returns positionals unchanged when the flag is absent', () => {
    expect(parseArgs(['billing-service', 'authz:admin'])).toEqual({
      positionals: ['billing-service', 'authz:admin'],
      writeEnvFile: undefined,
    })
  })

  it('extracts --write-env-file and keeps the positionals', () => {
    expect(
      parseArgs([
        'billing-service',
        'authz:admin',
        '--write-env-file',
        '/run/s2s/s2s.env',
      ])
    ).toEqual({
      positionals: ['billing-service', 'authz:admin'],
      writeEnvFile: '/run/s2s/s2s.env',
    })
  })

  it('accepts the flag before the positionals', () => {
    expect(
      parseArgs([
        '--write-env-file',
        '/tmp/x.env',
        'billing-service',
        'authz:admin',
      ])
    ).toEqual({
      positionals: ['billing-service', 'authz:admin'],
      writeEnvFile: '/tmp/x.env',
    })
  })

  it('throws when the flag has no value', () => {
    expect(() =>
      parseArgs(['billing-service', 'authz:admin', '--write-env-file'])
    ).toThrow(/requires a path argument/)
  })

  it('throws rather than swallowing the next flag as the path', () => {
    // Without this guard `--write-env-file --verbose` would silently write the
    // credential to a file literally named "--verbose".
    expect(() =>
      parseArgs([
        'billing-service',
        'authz:admin',
        '--write-env-file',
        '--verbose',
      ])
    ).toThrow(/requires a path argument/)
  })
})

describe('writeCredentialsEnvFile', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 's2s-creds-'))

  it('writes both keys in env-file form, newline-terminated', () => {
    const path = join(dir(), 's2s.env')
    writeCredentialsEnvFile(path, {
      clientId: 'cid-123',
      clientSecret: 'sek-456',
    })
    expect(readFileSync(path, 'utf8')).toBe(
      'AUTHENTIK_CLIENT_ID=cid-123\nAUTHENTIK_CLIENT_SECRET=sek-456\n'
    )
  })

  it('creates the file 0600 — it holds a live credential', () => {
    const path = join(dir(), 's2s.env')
    writeCredentialsEnvFile(path, { clientId: 'cid', clientSecret: 'sek' })
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('creates the parent directory if the mount path is empty', () => {
    const path = join(dir(), 'nested', 'deeper', 's2s.env')
    writeCredentialsEnvFile(path, { clientId: 'cid', clientSecret: 'sek' })
    expect(readFileSync(path, 'utf8')).toContain('AUTHENTIK_CLIENT_ID=cid')
  })

  it.each([
    ['clientId', { clientId: '', clientSecret: 'sek' }],
    ['clientSecret', { clientId: 'cid', clientSecret: '' }],
  ])('refuses to write an empty %s', (name, creds) => {
    const path = join(dir(), 's2s.env')
    expect(() => writeCredentialsEnvFile(path, creds)).toThrow(
      new RegExp(`${name} is empty`)
    )
  })

  it.each([
    ['a newline', 'sek\nmore'],
    ['a carriage return', 'sek\rmore'],
  ])('refuses a clientSecret containing %s', (_label, clientSecret) => {
    // An env file cannot represent this: --from-env-file would read the
    // remainder as a separate bogus KEY=value line, or drop it, yielding a
    // TRUNCATED credential in the Secret rather than an error.
    const path = join(dir(), 's2s.env')
    expect(() =>
      writeCredentialsEnvFile(path, { clientId: 'cid', clientSecret })
    ).toThrow(/contains a newline/)
  })

  it('does not leave a partial file behind when validation fails', () => {
    const path = join(dir(), 's2s.env')
    expect(() =>
      writeCredentialsEnvFile(path, {
        clientId: 'cid',
        clientSecret: 'bad\nvalue',
      })
    ).toThrow()
    expect(() => statSync(path)).toThrow()
  })
})
