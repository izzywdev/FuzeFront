// Launcher abstraction for "build your application" sessions. The route layer
// depends only on `AppBuilderLauncher`; the default implementation POSTs to the
// FuzeAgent build API. Tests inject a stub via setBuilderLauncher().
//
// Config (env, never hard-coded; secrets arrive via SealedSecret refs):
//   FUZEAGENT_BUILD_API_URL    — absolute URL of the FuzeAgent build endpoint
//   FUZEAGENT_BUILD_API_TOKEN  — bearer token (NEVER logged)
//   APP_REGISTRY_PUBLIC_BASE_URL — optional absolute base for the status
//       callbackUrl; when unset the callback is the same-origin relative path
//       (FuzeAgent resolves it against the host it was invoked through).
import { log, errInfo } from './log'

export interface BuilderLaunchInput {
  /** Prefixed ids (front_abs_…, org_…, usr_…) — the wire form FuzeAgent stores. */
  buildSessionId: string
  organizationId: string
  requestedByUserId: string
  context: 'personal' | 'organization'
  name: string
  brief: string
}

export interface BuilderLaunchResult {
  agentSessionRef: string
  agentSessionUrl?: string
}

export interface AppBuilderLauncher {
  /** Returns the agent session handle, or throws (the route maps to 502). */
  launch(input: BuilderLaunchInput): Promise<BuilderLaunchResult>
}

const LAUNCH_TIMEOUT_MS = 10_000

export function buildCallbackUrl(buildSessionId: string): string {
  const path = `/api/v1/app-registry/build-sessions/${encodeURIComponent(buildSessionId)}/status`
  const base = (process.env.APP_REGISTRY_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  return `${base}${path}`
}

export class FuzeAgentHttpLauncher implements AppBuilderLauncher {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly timeoutMs: number = LAUNCH_TIMEOUT_MS
  ) {}

  async launch(input: BuilderLaunchInput): Promise<BuilderLaunchResult> {
    const start = Date.now()
    const ctx = { op: 'fuzeagent.build.launch', buildSessionId: input.buildSessionId }
    log.debug('fuzeagent.build.launch start', ctx)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
          'x-request-id': input.buildSessionId,
        },
        body: JSON.stringify({
          buildSessionId: input.buildSessionId,
          organizationId: input.organizationId,
          requestedByUserId: input.requestedByUserId,
          context: input.context,
          name: input.name,
          brief: input.brief,
          callbackUrl: buildCallbackUrl(input.buildSessionId),
        }),
        signal: controller.signal,
      })
      const elapsedMs = Date.now() - start
      if (!res.ok) {
        log.error('fuzeagent.build.launch rejected', { ...ctx, status: res.status, elapsedMs })
        throw new Error(`FuzeAgent build API responded ${res.status}`)
      }
      const body: any = await res.json().catch(() => ({}))
      const ref = body?.agentSessionRef ?? body?.sessionId ?? body?.id
      if (typeof ref !== 'string' || !ref) {
        log.error('fuzeagent.build.launch malformed response', { ...ctx, status: res.status, elapsedMs })
        throw new Error('FuzeAgent build API returned no session reference')
      }
      const agentSessionUrl =
        typeof (body?.agentSessionUrl ?? body?.sessionUrl) === 'string'
          ? (body.agentSessionUrl ?? body.sessionUrl)
          : undefined
      log.info('fuzeagent.build.launch end', { ...ctx, status: res.status, elapsedMs })
      return { agentSessionRef: ref, agentSessionUrl }
    } catch (err) {
      log.error('fuzeagent.build.launch failed', {
        ...ctx,
        elapsedMs: Date.now() - start,
        ...errInfo(err),
      })
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
}

let injected: AppBuilderLauncher | null = null

/** Test/DI seam — inject a stub launcher (or null to restore env resolution). */
export function setBuilderLauncher(l: AppBuilderLauncher | null): void {
  injected = l
}

/**
 * The configured launcher, or null when FUZEAGENT_BUILD_API_URL/TOKEN are unset
 * (the route answers 503 builder_unavailable and persists nothing).
 */
export function getBuilderLauncher(): AppBuilderLauncher | null {
  if (injected) return injected
  const url = process.env.FUZEAGENT_BUILD_API_URL
  const token = process.env.FUZEAGENT_BUILD_API_TOKEN
  if (!url || !token) return null
  return new FuzeAgentHttpLauncher(url, token)
}
