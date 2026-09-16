/**
 * SpecViewerFlow — route `/catalog/:repo/:service` (design/frames/devportal
 * 05-spec-viewer, 06-spec-viewer-states). GET /v1/catalog/{repo}/{service}.
 *
 * The manifest's route pattern is written as `/catalog/:product/:service`;
 * App.tsx keeps the pre-existing `:repo/:service` param names (the same URL
 * shape — `repo` names the same thing the frame calls `product`, e.g.
 * "fuzefront") since renaming params is a pure cosmetic diff the RED spec
 * does not assert on.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, EmptyState, StatusCallout, Skeleton } from '@fuzefront/design-system'
import { CodeBlock } from '../../components/ds/CodeBlock'
import { MethodBadge } from '../../components/ds/MethodBadge'
import { api, ApiError, type SpecRecord } from '../../services/api'

const STALE_AFTER_DAYS = 14

interface Operation {
  path: string
  method: string
  operationId: string
  summary?: string
  tags?: string[]
  parameters?: unknown
  requestBody?: unknown
  responses: Record<string, unknown>
}

interface RawOperation {
  operationId?: string
  summary?: string
  tags?: string[]
  parameters?: unknown
  requestBody?: unknown
  responses?: Record<string, unknown>
}

function extractOperations(spec: SpecRecord): Operation[] {
  const paths = (spec.rawSpec as { paths?: Record<string, Record<string, RawOperation>> }).paths ?? {}
  const ops: Operation[] = []
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation?.operationId) continue
      ops.push({
        path,
        method: method.toUpperCase(),
        operationId: operation.operationId,
        summary: operation.summary,
        tags: operation.tags,
        parameters: operation.parameters,
        requestBody: operation.requestBody,
        responses: operation.responses ?? {},
      })
    }
  }
  return ops
}

function isStale(fetchedAt: string): boolean {
  const ageMs = Date.now() - new Date(fetchedAt).getTime()
  return ageMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000
}

function downloadSpec(spec: SpecRecord) {
  const blob = new Blob([JSON.stringify(spec.rawSpec, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${spec.repo}-${spec.service}-${spec.version}.json`
  a.click()
  URL.revokeObjectURL(url)
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; spec: SpecRecord }
  | { kind: 'invalid'; spec: SpecRecord }
  | { kind: 'not-found' }
  | { kind: 'error'; httpStatus: number; message: string }

export function SpecViewerFlow() {
  const { repo, service } = useParams<{ repo: string; service: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<ViewState>({ kind: 'loading' })
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)

  function load() {
    if (!repo || !service) return
    setState({ kind: 'loading' })
    api
      .getSpec(repo, service)
      .then(spec => setState(spec.valid === false ? { kind: 'invalid', spec } : { kind: 'ready', spec }))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) setState({ kind: 'not-found' })
        else if (err instanceof ApiError) setState({ kind: 'error', httpStatus: err.status, message: err.message })
        else setState({ kind: 'error', httpStatus: 0, message: err instanceof Error ? err.message : 'Failed to load the spec.' })
      })
  }

  useEffect(load, [repo, service])

  const operations = useMemo(() => (state.kind === 'ready' ? extractOperations(state.spec) : []), [state])
  const selected = operations.find(o => o.operationId === selectedOperationId) ?? operations[0]

  if (state.kind === 'loading') {
    return (
      <div className="dp-stack" data-state="loading">
        <Skeleton height="6rem" />
        <Skeleton height="20rem" />
      </div>
    )
  }

  if (state.kind === 'not-found') {
    return (
      <div data-state="not-found">
        <EmptyState
          data-empty="spec-not-found"
          data-http="404"
          title="No spec found"
          body={`No harvested spec for ${repo}/${service}. It may have been removed or renamed.`}
          action={
            <Button size="sm" data-action="back-to-catalog" onClick={() => navigate('/catalog')}>
              Back to catalog
            </Button>
          }
        />
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div data-state="error">
        <StatusCallout
          tone="error"
          title="Couldn't load this spec"
          data-error="spec-fetch-failed"
          data-http={state.httpStatus || undefined}
        >
          {state.message} This isn't a problem with your account — the spec document itself could not be retrieved.
          <div className="dp-row" style={{ marginTop: 'var(--space-3)' }}>
            <Button size="sm" data-action="retry" onClick={load}>Retry</Button>
            <Button size="sm" variant="secondary" data-action="back-to-catalog" onClick={() => navigate('/catalog')}>
              Back to catalog
            </Button>
          </div>
        </StatusCallout>
      </div>
    )
  }

  if (state.kind === 'invalid') {
    const spec = state.spec
    return (
      <div className="dp-stack" data-state="invalid-spec" data-spec-validity="invalid">
        <SpecHeaderPanel spec={spec} />
        <StatusCallout tone="error" title="This spec doesn't parse as valid OpenAPI" data-error="spec-invalid">
          The document from <strong>{spec.repo}</strong> could not be rendered — a half-parsed spec would build a request
          builder for operations that don't actually exist, so Try it stays disabled until it's fixed.
          <div style={{ marginTop: 'var(--space-3)' }}>
            <CodeBlock
              data-code="validation-errors"
              title="Validator output"
              code={(spec.validationErrors ?? ['Unknown validation error.']).join('\n')}
            />
          </div>
          <div className="dp-row" style={{ marginTop: 'var(--space-3)' }}>
            <Button
              size="sm"
              disabled
              data-action="try-it"
              data-try-it="disabled"
              aria-describedby="try-it-disabled-reason"
            >
              Try it
            </Button>
            <span id="try-it-disabled-reason" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Disabled — this spec failed validation.
            </span>
            <ExternalReportLink spec={spec} />
            <Button size="sm" variant="secondary" data-action="view-last-valid">
              View last valid version
            </Button>
          </div>
        </StatusCallout>
      </div>
    )
  }

  const spec = state.spec
  const stale = isStale(spec.fetchedAt)

  return (
    <div className="dp-spec-layout" data-state={stale ? 'stale' : undefined}>
      <aside className="dp-panel dp-panel-tight" data-panel="endpoint-list">
        <h2 style={{ fontSize: 'var(--text-sm)' }}>Operations</h2>
        <div className="dp-stack-sm">
          {operations.map(op => (
            <button
              key={op.operationId}
              type="button"
              className="dp-operation-row"
              data-operation={op.operationId}
              aria-selected={selected?.operationId === op.operationId}
              onClick={() => setSelectedOperationId(op.operationId)}
            >
              <MethodBadge method={op.method} size="sm" />
              <span>{op.path}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="dp-stack">
        <SpecHeaderPanel spec={spec} stale={stale} />

        <section className="dp-panel" data-panel="spec-overview">
          <h2>Overview</h2>
          <p>{(spec.rawSpec as { info?: { description?: string } }).info?.description ?? 'No description provided.'}</p>
        </section>

        {selected && (
          <section className="dp-panel dp-stack" data-panel="operation">
            <div className="dp-row-between">
              <div className="dp-row">
                <MethodBadge method={selected.method} />
                <span className="mono">{selected.path}</span>
              </div>
              <div className="dp-row">
                <Button size="sm" data-action="try-it" data-action-operation={selected.operationId} onClick={() => navigate(`/playground?specId=${spec.id}&operationId=${selected.operationId}`)}>
                  Try it
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="try-it-operation"
                  onClick={() => navigate(`/playground?specId=${spec.id}&operationId=${selected.operationId}`)}
                >
                  Try {selected.operationId}
                </Button>
              </div>
            </div>
            {selected.summary && <p>{selected.summary}</p>}

            <div className="dp-field-grid">
              <div data-panel="request-schema">
                <h3 style={{ fontSize: 'var(--text-sm)' }}>Request</h3>
                <CodeBlock code={JSON.stringify(selected.requestBody ?? selected.parameters ?? {}, null, 2)} copyable={false} />
              </div>
              <div data-panel="response-schema">
                <h3 style={{ fontSize: 'var(--text-sm)' }}>Responses</h3>
                <div className="dp-response-tabs">
                  {Object.entries(selected.responses).map(([status, body]) => (
                    <div key={status}>
                      <span className="mono" style={{ fontWeight: 'var(--weight-semibold)' }}>{status}</span>
                      <CodeBlock code={JSON.stringify(body, null, 2)} copyable={false} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div data-panel="code-sample">
              <h3 style={{ fontSize: 'var(--text-sm)' }}>Code sample</h3>
              <CodeBlock
                title="curl (sandbox)"
                code={`curl -X ${selected.method} "https://sandbox.developers.fuzefront.com${selected.path}" \\\n  -H "content-type: application/json"`}
              />
            </div>
          </section>
        )}

        <div className="dp-row">
          <Button variant="secondary" size="sm" data-action="download-spec" onClick={() => downloadSpec(spec)}>
            Download spec
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-action="open-in-playground"
            onClick={() => navigate(`/playground?specId=${spec.id}${selected ? `&operationId=${selected.operationId}` : ''}`)}
          >
            Open in playground
          </Button>
        </div>
      </div>
    </div>
  )
}

function SpecHeaderPanel({ spec, stale }: { spec: SpecRecord; stale?: boolean }) {
  const info = (spec.rawSpec as { info?: { title?: string }; openapi?: string }) ?? {}
  return (
    <section className="dp-panel" data-panel="spec-header" data-spec={`${spec.repo}/${spec.service}`}>
      <div className="dp-row-between">
        <h1 style={{ fontSize: 'var(--text-xl)' }}>{info.info?.title ?? spec.service}</h1>
        {stale && (
          <span data-catalog="stale" className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--warning-color)' }}>
            stale — harvested {new Date(spec.fetchedAt).toLocaleDateString()}
          </span>
        )}
      </div>
      <div className="dp-row" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        <span data-spec-version={spec.version} className="mono">v{spec.version}</span>
        <span>·</span>
        <span data-source-repo={spec.repo} className="mono">{spec.repo}</span>
        <span>·</span>
        <span className="mono">{spec.specPath}</span>
        <span>·</span>
        <span className="mono">{info.openapi ?? 'OpenAPI'}</span>
        <span>·</span>
        <span>harvested {new Date(spec.fetchedAt).toLocaleDateString()}</span>
      </div>
    </section>
  )
}

function ExternalReportLink({ spec }: { spec: SpecRecord }) {
  return (
    <a
      data-action="report-to-source-repo"
      href={`https://github.com/izzywdev/FuzeFront/issues/new?title=${encodeURIComponent(`Invalid OpenAPI spec: ${spec.repo}/${spec.service}`)}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{ fontSize: 'var(--text-sm)', color: 'var(--accent-color)' }}
    >
      Report to {spec.repo}
    </a>
  )
}
