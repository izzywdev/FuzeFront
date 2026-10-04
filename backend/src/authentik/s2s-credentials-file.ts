// s2s-credentials-file.ts — argv parsing and the credential-file writer for
// register-s2s-cli.ts.
//
// These live in their own module, NOT in the CLI, for one concrete reason:
// register-s2s-cli.ts calls `main()` at module load (it is a one-shot Job entry
// point, which is the right shape for that file). A unit test that imported the
// helpers from there would therefore execute a real Authentik registration as an
// import side effect, and exit the test process. Keeping the pure, testable
// parts here means they can be tested directly while the CLI keeps its
// run-on-import behaviour unchanged.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Pull `--write-env-file <path>` out of argv, returning the path (or undefined)
 * and the remaining positional arguments.
 *
 * Parsed positionally rather than with a flag library because this CLI is a
 * one-shot Job entry point with exactly two positionals; adding a dependency
 * for one optional flag is not worth it.
 */
export function parseArgs(argv: string[]): {
  positionals: string[]
  writeEnvFile?: string
} {
  const positionals: string[] = []
  let writeEnvFile: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write-env-file') {
      writeEnvFile = argv[i + 1]
      if (!writeEnvFile || writeEnvFile.startsWith('--')) {
        throw new Error('--write-env-file requires a path argument')
      }
      i++
      continue
    }
    positionals.push(argv[i])
  }
  return { positionals, writeEnvFile }
}

/**
 * Write the credentials to `path` as an env file, mode 0600.
 *
 * The KEY names are AUTHENTIK_CLIENT_ID / AUTHENTIK_CLIENT_SECRET because that
 * is what the consuming service reads (billing-service's
 * src/services/machineToken.ts), and because `kubectl create secret generic
 * --from-env-file` turns each KEY into a Secret key of the same name — so the
 * file IS the Secret's contents, with no transformation step to get wrong.
 *
 * The file is created with mode 0600 and intended for a memory-backed emptyDir
 * shared only between containers of one pod. Nothing here is printed: the only
 * thing written to stdout about the secret is its length, via mask().
 *
 * A secret containing a newline would corrupt an env file (the remainder would
 * parse as a bogus KEY=value line, or be silently dropped). Authentik's
 * client_secret is generated from a URL-safe alphabet and cannot contain one,
 * but asserting beats assuming — a malformed handoff must fail here, loudly,
 * not produce a Secret with a truncated credential that fails later as an
 * opaque 401 from the token endpoint.
 */
export function writeCredentialsEnvFile(
  path: string,
  creds: { clientId: string; clientSecret: string }
): void {
  for (const [name, value] of Object.entries(creds)) {
    if (!value) {
      throw new Error(`refusing to write ${path}: ${name} is empty`)
    }
    if (/[\r\n]/.test(value)) {
      throw new Error(
        `refusing to write ${path}: ${name} contains a newline, which an env file cannot represent`
      )
    }
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    `AUTHENTIK_CLIENT_ID=${creds.clientId}\nAUTHENTIK_CLIENT_SECRET=${creds.clientSecret}\n`,
    { mode: 0o600 }
  )
}
