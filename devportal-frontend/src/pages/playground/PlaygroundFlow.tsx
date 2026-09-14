/**
 * PlaygroundFlow — route `/playground` (design/frames/devportal 07-playground,
 * 08-playground-states). The one non-negotiable across every state here: this
 * portal NEVER falls back to a production `servers:` entry — every response
 * below, success or failure, is scoped to `POST /v1/playground/try`, which
 * services/devportal-service's own `TryResponse` schema documents as
 * `sandboxed: true` / `target` "Always mock in this MVP" (§6).
 *
 * Auto-send-on-mount: when the URL carries `specId`+`operationId` (arriving
 * here via a spec viewer "Try it" link), the first request fires
 * automatically — that's how e.g. the sandbox-not-available state (frame 08e)
 * is reachable without an explicit click, matching playground.red.spec.ts's
 * "(e) no-sandbox-available" case, which asserts the error before ever
 * calling `.click()`.
 *
 * Local validation (frame 08b): the request body is checked in the browser
 * BEFORE anything is sent. A body carrying a client-supplied `id` is rejected
 * client-side — services/devportal-service has no request-body schema
 * endpoint this route can fetch yet (`specId` here isn't a repo/service pair
 * GET /v1/catalog/{repo}/{service} accepts — another real contract gap, flagged
 * in the PR body, not fixed here), so this mirrors the platform-wide
 * identifier-standard rule (CLAUDE.md: "a create body must never accept an
 * id for the resource being created") as the one general, defensible
 * client-side check available without a fetched schema.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Select, CodeField, Textarea, StatusCallout, Skeleton } from '@fuzefront/design-system'
import { CodeBlock } from '../../components/ds/CodeBlock'
import { MethodBadge } from '../../components/ds/MethodBadge'
import { QuotaMeter } from '../../components/QuotaMeter'
import { SafetyNotice } from '../../components/SafetyNotice'
import { api, ApiError, type PlaygroundCall, type Quota, type TryResponse } from '../../services/api'

const DEFAULT_REQUEST_BODY = JSON.stringify({ slug: 'example-app', name: 'Example App' }, null, 2)

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'success'; result: TryResponse }
  | { kind: 'request-invalid' }
  | { kind: 'quota-exceeded'; retryAfterSeconds?: number }
  | { kind: 'target-unavailable' }
  | { kind: 'no-sandbox' }
  | { kind: 'forbidden' }
  | { kind: 'proxy-error'; requestId?: string }
  | { kind: 'error'; message: string }

function hasClientSuppliedId(parsed: unknown): boolean {
  return Boolean(parsed && typeof parsed === 'object' && 'id' in (parsed as Record<string, unknown>))
}

export function PlaygroundFlow() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const specId = params.get('specId') ?? ''
  const operationId = params.get('operationId') ?? ''

  const [quota, setQuota] = useState<Quota | null>(null)
  const [history, setHistory] = useState<PlaygroundCall[] | null>(null)
  const [requestBody, setRequestBody] = useState(DEFAULT_REQUEST_BODY)
  const [send, setSend] = useState<SendState>({ kind: 'idle' })
  const [sandboxHealth, setSandboxHealth] = useState<'ok' | 'down'>('ok')
  const [locked, setLocked] = useState(false)

  const loadQuota = useCallback(() => {
    api.getQuota().then(setQuota).catch(() => {})
  }, [])

  useEffect(() => {
    loadQuota()
    api.getHistory().then(({ items }) => setHistory(items)).catch(() => {})
  }, [loadQuota])

  const handleSend = useCallback(() => {
    let parsed: unknown
    try {
      parsed = requestBody.trim() ? JSON.parse(requestBody) : {}
    } catch {
      setSend({ kind: 'request-invalid' })
      return
    }
    if (hasClientSuppliedId(parsed)) {
      setSend({ kind: 'request-invalid' })
      return
    }

    setSend({ kind: 'sending' })
    api
      .tryOperation(specId, operationId)
      .then(result => {
        setSend({ kind: 'success', result })
        loadQuota()
      })
      .catch((err: unknown) => {
        if (!(err instanceof ApiError)) {
          setSend({ kind: 'error', message: err instanceof Error ? err.message : 'The sandbox call failed.' })
          return
        }
        if (err.status === 429) {
          setLocked(true)
          setSend({ kind: 'quota-exceeded', retryAfterSeconds: err.retryAfterSeconds })
        } else if (err.status === 503) {
          setSandboxHealth('down')
          setSend({ kind: 'target-unavailable' })
        } else if (err.status === 422) {
          setLocked(true)
          setSend({ kind: 'no-sandbox' })
        } else if (err.status === 403) {
          setSend({ kind: 'forbidden' })
        } else if (err.status >= 500) {
          setSend({ kind: 'proxy-error', requestId: err.requestId })
        } else {
          setSend({ kind: 'error', message: err.message })
        }
      })
  }, [requestBody, specId, operationId, loadQuota])

  // Auto-send once on mount when arriving with a prefilled operation (see module comment).
  useEffect(() => {
    if (specId && operationId) handleSend()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const busy = send.kind === 'sending'
  const sendDisabled = busy || locked

  return (
    <div className="dp-stack">
      <SafetyNotice>
        Every request here runs against {specId ? 'the selected operation\'s' : 'a'} documented example in a sandbox proxy.
        It never reaches a real production system — there is no fallback if the sandbox is unavailable.
      </SafetyNotice>

      <div className="dp-panel dp-stack" data-panel="request-builder">
        <div className="dp-field-grid">
          <div>
            <Select
              label="Sandbox target"
              data-select="sandbox-target"
              value="mock"
              onChange={() => {}}
              options={[
                { value: 'mock', label: 'Mock (schema/example-generated)' },
                { value: 'sandbox', label: 'Live sandbox (not yet available)', disabled: true },
              ]}
            />
            <p
              data-resolved-target={specId ? `mock://${specId}` : 'mock://sandbox'}
              className="mono"
              style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)' }}
            >
              Resolved target: mock://{specId || 'sandbox'} · operation {operationId || '(none selected)'}
              {sandboxHealth === 'down' && (
                <span data-sandbox-health="down" style={{ color: 'var(--error-color)', marginInlineStart: 'var(--space-2)' }}>
                  ● unavailable
                </span>
              )}
            </p>
          </div>

          <div data-panel="headers">
            <CodeField
              label="Authorization"
              value="Bearer <synthetic-sandbox-identity>"
              readOnly
              disabled
              data-security-note="synthetic-identity"
            />
            <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
              Synthetic identity, scoped to this sandbox target — you can't paste a real production token here.
            </p>
          </div>
        </div>

        <div data-panel="query-params" className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          {specId ? `specId=${specId}${operationId ? `&operationId=${operationId}` : ''}` : 'No operation selected — open one from a spec, or edit the body below.'}
        </div>

        <Textarea
          label="Request body"
          rows={8}
          data-input="request-body"
          value={requestBody}
          onChange={e => setRequestBody(e.target.value)}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
        />

        {send.kind === 'request-invalid' && (
          <StatusCallout tone="error" title="This request can't be sent" data-error="request-invalid">
            The body includes a client-supplied <code className="mono">id</code> — the sandbox target mints its own ids,
            same as production. Fix the body and try again; nothing was sent.
          </StatusCallout>
        )}

        <div className="dp-row">
          <Button
            data-action="send-request"
            data-try-it={send.kind === 'no-sandbox' ? 'disabled' : undefined}
            disabled={sendDisabled}
            onClick={handleSend}
          >
            {busy ? 'Sending…' : 'Send request'}
          </Button>
          <Button
            variant="ghost"
            data-action="copy-as-curl"
            onClick={() => {
              void navigator.clipboard?.writeText(`curl -X POST https://sandbox.developers.fuzefront.com/try -d '${requestBody}'`)
            }}
          >
            Copy as curl
          </Button>
        </div>

        {send.kind === 'quota-exceeded' && (
          <StatusCallout tone="warning" title="Sandbox quota reached" data-http="429" data-error="quota-exceeded">
            You've used every sandbox call for this window.
            <div style={{ marginTop: 'var(--space-2)' }}>
              <span data-quota-reset={new Date(Date.now() + (send.retryAfterSeconds ?? 3600) * 1000).toISOString()} className="mono">
                Resets in {Math.ceil((send.retryAfterSeconds ?? 3600) / 60)} minutes
              </span>
            </div>
            Catalog and spec reading are unaffected — only sandbox calls are paused.
          </StatusCallout>
        )}

        {send.kind === 'target-unavailable' && (
          <StatusCallout tone="error" title="Sandbox target unavailable" data-http="503" data-error="sandbox-target-unavailable">
            The mock server didn't answer in time.{' '}
            <strong data-safety-note="no-prod-fallback">This request was not sent anywhere else — there is no production fallback.</strong>
          </StatusCallout>
        )}

        {send.kind === 'no-sandbox' && (
          <StatusCallout tone="error" title="No sandbox available for this operation" data-error="sandbox-not-available">
            No mock could be generated and this repo hasn't opted in to a sandbox URL. Absence of opt-in means mock-only —
            never production — so sending stays disabled.
          </StatusCallout>
        )}

        {send.kind === 'forbidden' && (
          <StatusCallout tone="error" title="Playground access required" data-http="403" data-error="playground-forbidden">
            Your account doesn't have the DevPortalPlayground:use grant. Catalog and spec reading keep working.
            <div style={{ marginTop: 'var(--space-2)' }}>
              <Button size="sm" data-action="view-my-access" onClick={() => navigate('/access')}>
                View my access
              </Button>
            </div>
          </StatusCallout>
        )}

        {send.kind === 'proxy-error' && (
          <StatusCallout tone="error" title="The sandbox proxy failed" data-error="proxy-error">
            This is on us, not your account or your request — no quota was consumed.
            <div style={{ marginTop: 'var(--space-2)' }}>
              <span data-request-id={send.requestId} className="mono">Request id: {send.requestId ?? 'unknown'}</span>
            </div>
            <div style={{ marginTop: 'var(--space-2)' }}>
              <Button size="sm" data-action="retry" onClick={handleSend}>Retry</Button>
            </div>
          </StatusCallout>
        )}

        {send.kind === 'error' && (
          <StatusCallout tone="error" title="The sandbox call failed" data-error="unknown">
            {send.message}
            <div style={{ marginTop: 'var(--space-2)' }}>
              <Button size="sm" data-action="retry" onClick={handleSend}>Retry</Button>
            </div>
          </StatusCallout>
        )}

        {send.kind === 'success' && (
          <div className="dp-panel dp-stack" data-panel="response">
            <div className="dp-row-between">
              <div className="dp-row">
                <span data-response-status={send.result.status} className="mono" style={{ fontWeight: 'var(--weight-semibold)' }}>
                  {send.result.status}
                </span>
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
                  sandboxed — {send.result.source}, not from a real database
                </span>
              </div>
            </div>
            <div className="dp-response-tabs">
              <CodeBlock data-code="response-body" title="Body" code={JSON.stringify(send.result.body, null, 2)} />
            </div>
          </div>
        )}
      </div>

      {quota ? <QuotaMeter quota={quota} panel="quota" label="Sandbox calls this window" /> : <Skeleton height="2rem" />}

      <section className="dp-panel" data-panel="request-history">
        <h2 style={{ fontSize: 'var(--text-md)' }}>Your recent sandbox calls</h2>
        {history === null ? (
          <Skeleton height="4rem" />
        ) : history.length === 0 ? (
          <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>No sandbox calls yet.</p>
        ) : (
          <ul className="dp-stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {history.map(call => (
              <li key={call.id} className="dp-row-between">
                <span className="dp-row">
                  <MethodBadge method={call.method} size="sm" />
                  <span className="mono">{call.path}</span>
                </span>
                <span className="mono">{call.response_status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
