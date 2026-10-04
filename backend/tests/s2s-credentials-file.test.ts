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
    // A plain string, not `new RegExp(...)`. Jest treats a string argument to
    // toThrow() as a SUBSTRING match, which is exactly as strict as the
    // unanchored, metacharacter-free regex this replaces — and it drops the
    // dynamically-constructed RegExp that Semgrep's
    // javascript.lang.security.audit.detect-non-literal-regexp rightly flags
    // (alert 2328). Harmless here because `name` is a hardcoded table value,
    // but there is no reason to build a regex at all.
    expect(() => writeCredentialsEnvFile(path, creds)).toThrow(
      `${name} is empty`
    )
  })

  it.each([
    ['a newline', 'sek\nmore'],
    ['a carriage return', 'sek\rmore'],
    ['a tab', 'sek\tmore'],
    ['a space', 'sek more'],
    ['a NUL', 'sek\u0000more'],
    ['a DEL', 'sek\u007fmore'],
    ['a non-ASCII character', 'sek\u00e9more'],
  ])('refuses a clientSecret containing %s', (_label, clientSecret) => {
    // These values come off Authentik's provider API response, i.e. they are
    // NETWORK DATA reaching the filesystem (what CodeQL flags on this file, and
    // it is right to). The concrete risk is LINE INJECTION: a CR or LF lets the
    // remainder parse as an extra KEY=value line, so a hostile value could forge
    // an entry or silently truncate the real credential into one that fails much
    // later as an opaque 401 from the token endpoint.
    const path = join(dir(), 's2s.env')
    expect(() =>
      writeCredentialsEnvFile(path, { clientId: 'cid', clientSecret })
    ).toThrow(/outside printable ASCII/)
  })

  it('applies the allowlist to clientId too, not just the secret', () => {
    // clientId is equally network data, and a newline HERE is the more
    // interesting attack: it would forge the AUTHENTIK_CLIENT_SECRET line that
    // follows it in the file.
    const path = join(dir(), 's2s.env')
    expect(() =>
      writeCredentialsEnvFile(path, {
        clientId: 'cid\nAUTHENTIK_CLIENT_SECRET=forged',
        clientSecret: 'sek',
      })
    ).toThrow(/clientId contains a character outside printable ASCII/)
  })

  it.each([
    ['alphanumeric, as Authentik actually mints them', 'AbC123xyz789'],
    ['hyphens, as the existing test fixtures use', 's2s-client-id-xyz'],
    ['URL-safe base64 with padding', 'YWJjZGVmZ2g='],
    [
      'punctuation across the printable range',
      "a!#$%&'()*+,-./:;<=>?@[]^_`{|}~b",
    ],
  ])('accepts a credential made of %s', (_label, clientSecret) => {
    // The allowlist is deliberately GENEROUS (0x21-0x7E). Authentik mints these
    // from an alphanumeric alphabet today, but a tighter rule would false-reject
    // a legitimate credential if that ever widened -- and a false rejection here
    // aborts the cutover's PreSync Job.
    const path = join(dir(), 's2s.env')
    writeCredentialsEnvFile(path, { clientId: 'cid', clientSecret })
    expect(readFileSync(path, 'utf8')).toBe(
      `AUTHENTIK_CLIENT_ID=cid\nAUTHENTIK_CLIENT_SECRET=${clientSecret}\n`
    )
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
