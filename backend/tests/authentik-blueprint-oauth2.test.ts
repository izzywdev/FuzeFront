/**
 * authentik-blueprint-oauth2.test.ts
 *
 * Structural guard over the Authentik OAuth2 blueprints in
 * deploy/helm/fuzefront/authentik/blueprints/.
 *
 * WHY THIS EXISTS: three omissions in an `authentik_providers_oauth2.oauth2provider`
 * entry each break SSO in a way that gives you no usable signal, and all three
 * have cost real hours:
 *
 *   1. Missing `grant_types`. On Authentik 2026.x a provider created without it
 *      has an EMPTY grant-type allow-list, so every /application/o/authorize/
 *      request comes back `?error=invalid_request`. The provider exists, the
 *      discovery document is a healthy 200, and the login is simply dead.
 *
 *   2. Missing `invalidation_flow`. The blueprint entry fails SILENTLY — the
 *      provider is never created at all, and the only evidence is a line in the
 *      Authentik worker log.
 *
 *   3. An authorization flow with `authentication: require_authenticated`.
 *      Reaching it requires a session the user cannot have yet, so the
 *      authorize leg dead-ends before it ever renders.
 *
 * A 200 from /.well-known/openid-configuration does NOT detect any of these.
 * That is exactly the check that hid a total outage for hours, which is why the
 * assertions below are structural rather than a liveness probe.
 *
 * Text-based on purpose: these blueprints use Authentik's custom YAML tags
 * (!Find, !Env, !KeyOf), which a stock YAML loader rejects, and the backend has
 * no YAML parser dependency to teach them to.
 */

import * as fs from 'fs'
import * as path from 'path'

const BLUEPRINT_DIR = path.resolve(
  __dirname,
  '../../deploy/helm/fuzefront/authentik/blueprints'
)

const PROVIDER_MODEL = '- model: authentik_providers_oauth2.oauth2provider'

/** Every blueprint file that declares at least one OAuth2 provider. */
function blueprintFiles(): string[] {
  return fs
    .readdirSync(BLUEPRINT_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => path.join(BLUEPRINT_DIR, f))
    .filter((p) => fs.readFileSync(p, 'utf8').includes(PROVIDER_MODEL))
}

/**
 * Split a blueprint into one chunk per oauth2provider entry. A chunk runs from
 * its `- model:` line to the line before the next top-level `- model:`, which is
 * the whole of that entry's identifiers + attrs.
 */
function providerEntries(source: string): { name: string; body: string }[] {
  const lines = source.split('\n')
  const starts: number[] = []
  lines.forEach((line, i) => {
    if (line.trimEnd().endsWith('- model: authentik_providers_oauth2.oauth2provider')) {
      starts.push(i)
    }
  })

  return starts.map((start, idx) => {
    // The entry ends where the next `- model:` of ANY kind begins.
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\s*- model:/.test(lines[i])) {
        end = i
        break
      }
    }
    const body = lines.slice(start, end).join('\n')
    const nameMatch = body.match(/^\s*name:\s*(.+)$/m)
    return {
      name: nameMatch ? nameMatch[1].trim() : `entry #${idx + 1}`,
      body,
    }
  })
}

describe('Authentik OAuth2 provider blueprints', () => {
  const files = blueprintFiles()

  it('finds the blueprints (a rename must not silently disable this guard)', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  describe.each(files.map((f) => [path.basename(f), f]))('%s', (_base, file) => {
    const source = fs.readFileSync(file, 'utf8')
    const entries = providerEntries(source)

    it('declares at least one provider', () => {
      expect(entries.length).toBeGreaterThan(0)
    })

    it.each(entries.map((e) => [e.name, e.body]))(
      '%s declares grant_types including authorization_code',
      (_name, body) => {
        // Without this Authentik 2026.x rejects EVERY authorize request with
        // error=invalid_request. See the header comment.
        expect(body).toMatch(/^\s*grant_types:\s*$/m)
        expect(body).toMatch(/^\s*-\s*authorization_code\s*$/m)
      }
    )

    it.each(entries.map((e) => [e.name, e.body]))(
      '%s declares invalidation_flow',
      (_name, body) => {
        // Without this the blueprint entry fails silently and the provider is
        // never created.
        expect(body).toMatch(/^\s*invalidation_flow:/m)
      }
    )

    it.each(entries.map((e) => [e.name, e.body]))(
      '%s declares an authorization_flow',
      (_name, body) => {
        expect(body).toMatch(/^\s*authorization_flow:/m)
      }
    )
  })

  describe('authorization flows referenced by those providers', () => {
    /**
     * Collect every flow slug that a provider names in `authorization_flow`,
     * then assert that wherever this repo DEFINES that flow it is reachable
     * without a session. `require_authenticated` on an authorization flow means
     * the user must already be logged in to log in.
     */
    const referenced = new Set<string>()
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      for (const { body } of providerEntries(source)) {
        const m = body.match(
          /authorization_flow:\s*!Find\s*\[\s*authentik_flows\.flow\s*,\s*\[\s*slug\s*,\s*([^\]]+?)\s*\]\s*\]/
        )
        if (m) referenced.add(m[1].replace(/^["']|["']$/g, '').trim())
      }
    }

    it('references at least one flow by slug', () => {
      expect(referenced.size).toBeGreaterThan(0)
    })

    /**
     * Flows that currently declare `authentication: require_authenticated` and
     * are NOT changed here.
     *
     * These are the two MendysRobotics flows, owned by a different stream. They
     * are listed rather than fixed because this suite was added alongside the
     * FuzeInfra admin-plane SSO work and fixing another product's login flow in
     * passing is not a safe drive-by: `require_authenticated` is what upstream
     * Authentik's own shipped `default-provider-authorization-implicit-consent`
     * uses, so whether it is wrong here depends on how their brand's default
     * authentication flow is bound — which is unverified.
     *
     * The FuzeInfra and FuzeFront flows deliberately use `none`, for the reason
     * spelled out in provider-oidc-fuzeinfra-admin.yaml. If the Mendys flows are
     * confirmed broken, fix them and DELETE the entry here rather than growing
     * this list.
     */
    const KNOWN_DEVIATIONS = new Set([
      'mendys-datasets-authorization-implicit-consent',
      'mendys-platform-authorization-implicit-consent',
    ])

    it('never uses require_authenticated on a locally-defined authorization flow', () => {
      const allSources = fs
        .readdirSync(BLUEPRINT_DIR)
        .filter((f) => f.endsWith('.yaml'))
        .map((f) => fs.readFileSync(path.join(BLUEPRINT_DIR, f), 'utf8'))
        .join('\n')

      for (const slug of referenced) {
        if (KNOWN_DEVIATIONS.has(slug)) continue
        // Only flows this repo defines can be asserted on; Authentik's own
        // built-ins (default-*) are not ours to check.
        const defIdx = allSources.indexOf(`slug: ${slug}`)
        if (defIdx === -1) continue

        // The flow object's own attrs block: from the LAST `slug: <slug>` (the
        // attrs copy, after the identifiers copy) to the next entry.
        const lastIdx = allSources.lastIndexOf(`slug: ${slug}`)
        const rest = allSources.slice(lastIdx)
        const nextEntry = rest.search(/\n\s*- model:/)
        const flowBody = nextEntry === -1 ? rest : rest.slice(0, nextEntry)

        expect(flowBody).toMatch(/^\s*authentication:\s*none\s*$/m)
      }
    })
  })
})
