/**
 * Health probing for registered apps. Deliberately its own module with NO
 * express and NO database import, so it can be unit-tested as the pure function
 * it is — the rest of routes/apps.ts needs a live Postgres to import.
 */

/** The subset of an apps row this probe reads. */
export interface ProbeableApp {
  name: string
  url: string
  integration_type: 'iframe' | 'module-federation' | 'web-component' | 'spa'
  remote_url: string
}

/**
 * HEALTH FOR A FEDERATED APP MEANS "THE MODULE LOADS", NOT "SOMETHING ANSWERED".
 *
 * This function used to be:
 *
 *     const healthUrl = `${app.url}`
 *     ...
 *     return response.status < 500   // "Consider 2xx, 3xx, 4xx as healthy"
 *
 * which reported an app healthy when its URL returned **404**. A production probe
 * of all 16 registered remotes found 0 serving a module and the portal calling
 * every one of them green: 12 returned 404 (nothing mounted at the path at all),
 * 3 returned 503 (route exists, no healthy backend), and 1 returned 200 with HTML
 * — the host shell's own SPA fallback answering for a file that does not exist.
 * A check that cannot tell "nothing is served here" from "this works" is not a
 * health check.
 *
 * So the probe now depends on what the app actually is:
 *
 *  - `module-federation`: fetch the registered remote entry and require HTTP 200
 *    **and** a JavaScript body. The content-type/HTML test is not belt-and-braces
 *    — it is the only thing that catches the SPA-fallback case, where the status
 *    line says 200 and the bytes are the host's index.html. Same rule as
 *    scripts/check-federated-assets.mjs, deliberately, so the CI probe and the
 *    runtime check cannot disagree about what "serving" means.
 *
 *  - everything else (`iframe`, `spa`, `web-component`): fetch the app URL and
 *    require < 400. A 404 on an app's own root means nothing is there; that is
 *    the whole point.
 *
 * `remote_url` may be same-origin-relative (`/apps/<slug>/remoteEntry.js`, the
 * stored form since migration 011) or an absolute URL (legacy cross-origin
 * registrations). Relative values resolve against `origin`, matching how
 * frontend/src/utils/loadFederatedApp.ts resolves them in the browser; absolute
 * values are probed verbatim, so a cross-origin registration is judged on the
 * host it actually names rather than on a path it never claimed.
 */
const LOOKS_LIKE_HTML = /^\s*(?:<!doctype\s+html|<html\b)/i
const JS_CONTENT_TYPE = /\b(?:java|ecma)script\b/i

interface HealthResult {
  isHealthy: boolean
  httpStatus: number | null
  reason: string | null
}

const HEALTHY: HealthResult = { isHealthy: true, httpStatus: 200, reason: null }

/**
 * Returns a discriminated result rather than throwing, so the caller never needs
 * to name the `Response` type. That keeps this file compiling identically whether
 * or not DOM lib types are in scope — the annotation was the only thing that
 * would have depended on them.
 */
async function fetchWithTimeout(url: string, accept: string) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: accept },
    })
    return { ok: true as const, response }
  } catch (error: unknown) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * The origin a same-origin `remote_url` resolves against. Configurable because
 * the API pod may not be able to reach its own public hostname from inside the
 * cluster; when it cannot, the probe reports unhealthy with the network error
 * named, rather than quietly reporting healthy the way the old one did.
 */
export function probeOrigin(req: any): string {
  const configured = (process.env.FEDERATION_PROBE_ORIGIN || '').trim()
  if (configured) return configured.replace(/\/+$/, '')
  const fwdProto = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
  const fwdHost = String(req?.headers?.['x-forwarded-host'] || '')
    .split(',')[0]
    .trim()
  const proto = fwdProto || req?.protocol || 'https'
  const host = fwdHost || req?.headers?.host || ''
  return `${proto}://${host}`.replace(/\/+$/, '')
}

export async function checkAppHealth(
  app: ProbeableApp,
  origin: string
): Promise<HealthResult> {
  const federated = app.integration_type === 'module-federation'
  let target: string

  if (federated) {
    const raw = (app.remote_url || '').trim()
    if (!raw) {
      return {
        isHealthy: false,
        httpStatus: null,
        reason:
          'registered as module-federation but has no remote_url — there is nothing for the host to import',
      }
    }
    try {
      target = new URL(raw, origin || undefined).toString()
    } catch {
      return {
        isHealthy: false,
        httpStatus: null,
        reason: `remote_url '${raw}' is not resolvable against origin '${origin}'`,
      }
    }
  } else {
    target = app.url
    if (!target) {
      return { isHealthy: false, httpStatus: null, reason: 'no url registered' }
    }
  }

  const probe = await fetchWithTimeout(
    target,
    federated
      ? 'application/javascript,text/javascript,*/*'
      : 'text/html,application/json'
  )
  if (!probe.ok) {
    console.log(`Health check failed for ${app.name} (${target}):`, probe.message)
    return {
      isHealthy: false,
      httpStatus: null,
      reason: `could not reach ${target}: ${probe.message}`,
    }
  }
  const response = probe.response

  if (!federated) {
    return response.status < 400
      ? { ...HEALTHY, httpStatus: response.status }
      : {
          isHealthy: false,
          httpStatus: response.status,
          reason: `${target} returned ${response.status}`,
        }
  }

  if (response.status !== 200) {
    return {
      isHealthy: false,
      httpStatus: response.status,
      reason:
        response.status === 404
          ? `remote entry ${target} returned 404 — nothing is mounted at that path`
          : response.status === 503
            ? `remote entry ${target} returned 503 — the route exists but has no healthy backend`
            : `remote entry ${target} returned ${response.status}, not 200`,
    }
  }

  const contentType = response.headers.get('content-type') || ''

  if (/text\/html/i.test(contentType)) {
    return {
      isHealthy: false,
      httpStatus: 200,
      reason: `remote entry ${target} returned 200 but is served as HTML — this is an SPA fallback answering for a file that does not exist`,
    }
  }

  // A JavaScript content-type settles it. Return WITHOUT reading the body: a
  // remoteEntry bundle can be hundreds of KB and this runs once per app on every
  // listing request, so downloading it to confirm what the header already said
  // would be the expensive way to learn nothing.
  if (JS_CONTENT_TYPE.test(contentType)) {
    return { ...HEALTHY, httpStatus: 200 }
  }

  // Inconclusive content-type (missing, or application/octet-stream from a
  // misconfigured static server). Only here is the body worth sniffing, and only
  // its first bytes — enough to tell an HTML document from anything else.
  let head = ''
  try {
    head = (await response.text()).slice(0, 512)
  } catch {
    /* unreadable body: fall through to the content-type verdict below */
  }

  if (LOOKS_LIKE_HTML.test(head)) {
    return {
      isHealthy: false,
      httpStatus: 200,
      reason: `remote entry ${target} returned 200 with content-type '${contentType || 'none'}' and an HTML body — an SPA fallback answering for a file that does not exist`,
    }
  }

  return {
    isHealthy: false,
    httpStatus: 200,
    reason: `remote entry ${target} returned 200 with content-type '${contentType || 'none'}', which is not JavaScript — the host imports this as a module, so a non-JS body cannot load`,
  }
}
