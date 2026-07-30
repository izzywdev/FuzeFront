import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Braces,
  Building2,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  Database,
  FileCode2,
  GitBranch,
  Eye,
  ExternalLink,
  Layers3,
  LockKeyhole,
  LogOut,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TestTube2,
  X,
} from 'lucide-react'
import type {
  ApiOperation,
  AdminTenantContext,
  CoverageState,
  FrontendSurface,
  Portfolio,
  OrganizationQualitySummary,
  Repository,
  StorybookStory,
  TestExpectation,
  TestImplementationRequest,
} from '@fuzequality/contracts'
import { api } from './api'
import { planGap } from './testPlan'
import { storybookPreviewUrl } from './storybook'

type View = 'overview' | 'repositories' | 'api' | 'frontend' | 'requirements' | 'review' | 'administration'

const navigation: Array<{ id: View; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Portfolio', icon: Activity },
  { id: 'repositories', label: 'Repositories', icon: GitBranch },
  { id: 'api', label: 'API catalog', icon: Braces },
  { id: 'frontend', label: 'Frontend inventory', icon: Layers3 },
  { id: 'requirements', label: 'Requirements & flows', icon: Network },
  { id: 'review', label: 'AI review queue', icon: Sparkles },
  { id: 'administration', label: 'Organizations', icon: Building2 },
]

const coverageLabel: Record<CoverageState, string> = {
  'covered-explicit': 'Covered',
  'covered-generated': 'Generated',
  'likely-covered': 'Likely',
  gap: 'Gap',
  excluded: 'Excluded',
  unknown: 'Unknown',
}

function coverageSummary(expectations: TestExpectation[]) {
  const relevant = expectations.filter(item => item.priority !== 'not-applicable')
  const covered = relevant.filter(item => item.coverage.startsWith('covered')).length
  return {
    total: relevant.length,
    covered,
    gaps: relevant.filter(item => item.coverage === 'gap').length,
    percent: relevant.length ? Math.round((covered / relevant.length) * 100) : 0,
  }
}

function CoverageRail({ expectations }: { expectations: TestExpectation[] }) {
  const visible = expectations.slice(0, 36)
  return (
    <div className="coverage-rail" aria-label="Coverage evidence rail">
      {visible.length ? (
        visible.map(item => (
          <span
            key={item.id}
            className={`rail-segment state-${item.coverage}`}
            title={`${item.label}: ${coverageLabel[item.coverage]}`}
          />
        ))
      ) : (
        <span className="rail-empty">No expectations indexed yet</span>
      )}
    </div>
  )
}

function StatusPill({ state }: { state: CoverageState }) {
  return <span className={`status-pill state-${state}`}>{coverageLabel[state]}</span>
}

function GapPlanDrawer({ subject, repository, expectations, selectedId, onClose }: {
  subject: ApiOperation | FrontendSurface
  repository?: Repository
  expectations: TestExpectation[]
  selectedId: string
  onClose: () => void
}) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const gaps = expectations.filter(item => item.coverage === 'gap' && item.priority !== 'not-applicable')
  const [selected, setSelected] = useState(() => new Set(gaps.map(item => item.id)))
  const [implementation, setImplementation] = useState<TestImplementationRequest>()
  const [implementationError, setImplementationError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    closeButton.current?.focus()
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  useEffect(() => {
    if (!implementation || !['queued', 'running'].includes(implementation.status)) return
    const timer = window.setInterval(async () => {
      try { setImplementation(await api.testImplementation(implementation.id)) } catch { /* retain last known state */ }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [implementation])
  const implement = async () => {
    if (!repository?.lastScanRevision || selected.size === 0) return
    setSubmitting(true)
    setImplementationError('')
    try {
      setImplementation(await api.implementTests({
        repositoryId: repository.id,
        sourceRevision: repository.lastScanRevision,
        expectationIds: [...selected],
      }))
    } catch (error) {
      setImplementationError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }
  const subjectLabel = 'method' in subject ? `${subject.method.toUpperCase()} ${subject.path}` : `${subject.name} · ${subject.packageName}`
  return <div className="drawer-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <aside className="gap-drawer" role="dialog" aria-modal="true" aria-labelledby="gap-plan-title">
      <header className="drawer-header">
        <div><p className="eyebrow">Deterministic test planner</p><h2 id="gap-plan-title">{gaps.length} tests to close this gap</h2><code>{subjectLabel}</code></div>
        <button ref={closeButton} className="icon-button" onClick={onClose} aria-label="Close test plan"><X /></button>
      </header>
      <p className="drawer-intro">Generated from catalog policy and source metadata. These are authoritative expected tests—not AI suggestions.</p>
      <div className="implementation-toolbar">
        <label><input type="checkbox" checked={selected.size === gaps.length} onChange={event => setSelected(event.target.checked ? new Set(gaps.map(item => item.id)) : new Set())} /> Select all</label>
        <button className="primary-button" disabled={submitting || selected.size === 0 || !repository?.lastScanRevision} onClick={implement}>
          <Sparkles size={15} /> {submitting ? 'Launching…' : `Implement ${selected.size} selected`}
        </button>
      </div>
      {implementation && <div className={`implementation-status implementation-${implementation.status}`} role="status">
        <strong>Cloud Codex: {implementation.status}</strong>
        <span>{implementation.agentProfile} · {implementation.skills.join(', ')}</span>
        {implementation.workflowUrl && <a href={implementation.workflowUrl} target="_blank" rel="noreferrer">View workflow <ExternalLink size={13} /></a>}
        {implementation.pullRequestUrl && <a href={implementation.pullRequestUrl} target="_blank" rel="noreferrer">Open pull request <ExternalLink size={13} /></a>}
        {implementation.error && <span>{implementation.error}</span>}
      </div>}
      {implementationError && <div className="form-error" role="alert">{implementationError}</div>}
      <div className="planned-tests">{gaps.map((expectation, index) => {
        const plan = planGap(expectation, subject)
        return <article className={expectation.id === selectedId ? 'planned-test selected' : 'planned-test'} key={expectation.id}>
          <div className="plan-index"><input type="checkbox" aria-label={`Select ${plan.title}`} checked={selected.has(expectation.id)} onChange={event => setSelected(current => { const next = new Set(current); event.target.checked ? next.add(expectation.id) : next.delete(expectation.id); return next })} /><span>{String(index + 1).padStart(2, '0')}</span></div>
          <div className="plan-body">
            <div className="plan-heading"><div><span>{plan.priority} · {plan.level}</span><h3>{plan.title}</h3></div>{expectation.id === selectedId && <b>Selected gap</b>}</div>
            <dl className="plan-path"><dt>Suggested file</dt><dd><code>{plan.suggestedFile}</code></dd></dl>
            <div className="aaa-grid"><section><h4>Arrange</h4><p>{plan.arrange}</p></section><section><h4>Act</h4><p>{plan.act}</p></section><section><h4>Assert</h4><ul>{plan.assertions.map(assertion => <li key={assertion}>{assertion}</li>)}</ul></section></div>
            <footer><BookOpen size={13} /><span>{plan.provenance}</span></footer>
          </div>
        </article>
      })}</div>
    </aside>
  </div>
}

function ComponentPreviewDrawer({ surface, repository, onClose }: {
  surface: FrontendSurface
  repository?: Repository
  onClose: () => void
}) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const [story, setStory] = useState<StorybookStory | undefined>(surface.stories[0])
  const previewUrl = story && storybookPreviewUrl(repository?.storybookBaseUrl, story)
  useEffect(() => {
    closeButton.current?.focus()
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return <div className="drawer-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <aside className="preview-drawer" role="dialog" aria-modal="true" aria-labelledby="component-preview-title">
      <header className="drawer-header">
        <div><p className="eyebrow">Storybook visual reference</p><h2 id="component-preview-title">{surface.name}</h2><code>{surface.packageName} · {surface.sourcePath}</code></div>
        <button ref={closeButton} className="icon-button" onClick={onClose} aria-label="Close component preview"><X /></button>
      </header>
      {surface.stories.length > 0 ? <>
        <div className="preview-toolbar">
          <label>Story<select value={story?.id} onChange={event => setStory(surface.stories.find(item => item.id === event.target.value))}>{surface.stories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {previewUrl && <a href={previewUrl} target="_blank" rel="noreferrer">Open Storybook <ExternalLink size={14} /></a>}
        </div>
        {previewUrl
          ? <div className="storybook-frame"><iframe title={`${surface.name}: ${story?.name}`} src={previewUrl} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" /></div>
          : <div className="preview-empty"><Eye /><strong>Story discovered; preview host not configured</strong><span>Add this repository’s HTTPS Storybook URL to render its isolated story here.</span><code>{story?.sourcePath} · {story?.exportName}</code></div>}
        <footer className="preview-provenance"><BookOpen size={14} /> Static CSF metadata from the scanned commit. The iframe runs sandboxed without same-origin, navigation, or popup privileges.</footer>
      </> : <div className="preview-empty"><Eye /><strong>No Storybook visual reference found</strong><span>Add a co-located <code>*.stories.tsx</code> file and publish Storybook to make this component renderable.</span></div>}
    </aside>
  </div>
}

function Stat({ label, value, detail, tone = 'neutral' }: { label: string; value: string | number; detail: string; tone?: string }) {
  return (
    <article className={`stat stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

function Overview({ data, onNavigate }: { data: Portfolio; onNavigate: (view: View) => void }) {
  const summary = coverageSummary(data.expectations)
  const openFindings = data.findings.filter(item => item.status === 'open')
  return (
    <>
      <header className="page-header thesis">
        <div>
          <p className="eyebrow">Coverage snapshot / default branches</p>
          <h1>See what the platform promises—and where proof stops.</h1>
          <p className="lede">
            One evidence map across API contracts, frontend surfaces, tests, and product intent.
          </p>
        </div>
        <div className="coverage-dial" style={{ '--coverage': `${summary.percent * 3.6}deg` } as React.CSSProperties}>
          <span><strong>{summary.percent}%</strong> authoritative</span>
        </div>
      </header>

      <CoverageRail expectations={data.expectations} />
      <div className="rail-key">
        <span><i className="key-covered" /> accepted evidence</span>
        <span><i className="key-gap" /> required gap</span>
        <span><i className="key-likely" /> review needed</span>
      </div>

      <section className="stats-grid">
        <Stat label="Repositories" value={data.repositories.length} detail="default branches indexed" />
        <Stat label="API operations" value={data.operations.length} detail="across discovered contracts" />
        <Stat label="Frontend surfaces" value={data.surfaces.length} detail="routes, pages, components" />
        <Stat label="Required gaps" value={summary.gaps} detail="without accepted evidence" tone="danger" />
      </section>

      <section className="split-grid">
        <article className="panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Repository pulse</p><h2>Latest inventory</h2></div>
            <button className="text-button" onClick={() => onNavigate('repositories')}>Manage <ArrowRight size={15} /></button>
          </div>
          <div className="repo-list">
            {data.repositories.map(repository => {
              const expectations = data.expectations.filter(item => {
                const operation = data.operations.find(op => op.id === item.subjectId)
                const surface = data.surfaces.find(ui => ui.id === item.subjectId)
                return operation?.repositoryId === repository.id || surface?.repositoryId === repository.id
              })
              const repoSummary = coverageSummary(expectations)
              return (
                <div className="repo-row" key={repository.id}>
                  <div className="repo-mark">{repository.name.slice(0, 2).toUpperCase()}</div>
                  <div className="repo-copy"><strong>{repository.name}</strong><small>{repository.owner} / {repository.defaultBranch}</small></div>
                  <div className="mini-progress"><span style={{ width: `${repoSummary.percent}%` }} /></div>
                  <b>{repoSummary.percent}%</b>
                </div>
              )
            })}
          </div>
        </article>

        <article className="panel findings-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Attention queue</p><h2>Highest-impact gaps</h2></div>
            <button className="icon-button" aria-label="Refresh"><RefreshCw size={16} /></button>
          </div>
          <div className="finding-list">
            {openFindings.slice(0, 5).map(finding => (
              <div className="finding-row" key={finding.id}>
                <AlertTriangle size={17} />
                <div><strong>{finding.title}</strong><small>{finding.detail}</small></div>
                <span className={`severity severity-${finding.severity}`}>{finding.severity}</span>
              </div>
            ))}
            {!openFindings.length && <div className="empty-state"><ShieldCheck /><strong>No open findings</strong><span>Run a repository scan to calculate gaps.</span></div>}
          </div>
        </article>
      </section>
    </>
  )
}

function Repositories({ data, reload }: { data: Portfolio; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    owner: 'izzywdev',
    name: '',
    defaultBranch: 'main',
    kind: 'mixed',
    installationId: '',
    storybookBaseUrl: '',
  })
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const payload = { ...form, storybookBaseUrl: form.storybookBaseUrl || undefined, includeGlobs: [], excludeGlobs: [], jiraProjects: [] }
      await api.verifyRepository(payload)
      await api.addRepository(payload)
      setOpen(false); await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Repository onboarding failed')
    } finally { setBusy(false) }
  }
  async function scan(id: string, localPath?: string) {
    setBusy(true)
    try { await api.scanRepository(id, localPath); await reload() } finally { setBusy(false) }
  }
  return (
    <>
      <PageHeading eyebrow="Source control" title="Repository inventory" detail="Onboard read-only sources and inspect their latest deterministic scan." action={<button className="primary-button" onClick={() => setOpen(true)}><Plus size={16} /> Add repository</button>} />
      <section className="repo-cards">
        {data.repositories.map(repository => {
          const diagnostics = data.diagnostics.filter(item => item.repositoryId === repository.id)
          return <article className="repo-card" key={repository.id}>
            <div className="repo-card-top"><div className="repo-mark large">{repository.name.slice(0, 2).toUpperCase()}</div><span className={`scan-status scan-${repository.lastScanStatus}`}>{repository.lastScanStatus}</span></div>
            <h3>{repository.name}</h3><p>{repository.canonicalUrl}</p>
            <dl><div><dt>Branch</dt><dd>{repository.defaultBranch}</dd></div><div><dt>Kind</dt><dd>{repository.kind}</dd></div><div><dt>Revision</dt><dd title={repository.lastScanRevision}>{repository.lastScanRevision?.slice(0, 12) ?? 'Not scanned'}</dd></div><div><dt>Last scan</dt><dd>{repository.lastScanAt ? new Date(repository.lastScanAt).toLocaleString() : 'Never'}</dd></div></dl>
            {diagnostics.length > 0 && <details className="scan-diagnostics"><summary><AlertTriangle size={14} /> {diagnostics.length} scan {diagnostics.length === 1 ? 'diagnostic' : 'diagnostics'}</summary><div>{diagnostics.map(item => <article key={`${item.sourcePath}:${item.code}`}><span className={`diagnostic-severity diagnostic-${item.severity}`}>{item.severity}</span><code>{item.sourcePath}</code><strong>{item.code}</strong><p>{item.message}</p></article>)}</div></details>}
            <button className="secondary-button" disabled={busy} onClick={() => scan(repository.id, repository.localPath)}><RefreshCw size={15} /> Scan now</button>
          </article>
        })}
      </section>
      {open && <div className="modal-backdrop" role="presentation"><form className="modal" onSubmit={submit}><div className="modal-title"><div><p className="eyebrow">GitHub App source</p><h2>Add repository</h2></div><button type="button" className="icon-button" onClick={() => setOpen(false)}><X /></button></div><label>Owner<input value={form.owner} onChange={event => setForm({ ...form, owner: event.target.value })} required /></label><label>Repository name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="FuzeService" required /></label><label>GitHub App installation ID<input value={form.installationId} onChange={event => setForm({ ...form, installationId: event.target.value.trim() })} inputMode="numeric" placeholder="148577461" required /><small>The read-only FuzeQuality GitHub App installation that can access this repository.</small></label><label>Storybook URL (optional)<input type="url" value={form.storybookBaseUrl} onChange={event => setForm({ ...form, storybookBaseUrl: event.target.value.trim() })} placeholder="https://storybook.example.com" /><small>HTTPS host for sandboxed component previews. Story metadata is cataloged even without it.</small></label><div className="form-row"><label>Default branch<input value={form.defaultBranch} onChange={event => setForm({ ...form, defaultBranch: event.target.value })} /></label><label>Kind<select value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value })}><option value="mixed">Mixed</option><option value="service">Service</option><option value="application">Application</option><option value="library">Library</option><option value="infrastructure">Infrastructure</option></select></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Verifying…' : 'Verify and add'}</button></div></form></div>}
    </>
  )
}

function Matrix({ items, expectations, kind, repositories = [] }: { items: Array<ApiOperation | FrontendSurface>; expectations: TestExpectation[]; kind: 'api' | 'frontend'; repositories?: Repository[] }) {
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<{ subject: ApiOperation | FrontendSurface; expectationId: string }>()
  const [preview, setPreview] = useState<FrontendSurface>()
  const trigger = useRef<HTMLButtonElement | null>(null)
  const filtered = items.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()))
  function closePlan() {
    setSelection(undefined)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  return <><div className="filter-bar"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Filter ${kind === 'api' ? 'operations' : 'surfaces'}…`} /><span>{filtered.length} shown</span></div><div className="matrix"><div className="matrix-head"><span>{kind === 'api' ? 'Operation' : 'Surface'}</span><span>Expected evidence</span><span>Status</span></div>{filtered.map(item => { const rows = expectations.filter(expectation => expectation.subjectId === item.id); const surface = kind === 'frontend' ? item as FrontendSurface : undefined; return <div className="matrix-group" key={item.id}><div className="matrix-subject">{kind === 'api' ? <code><b>{(item as ApiOperation).method.toUpperCase()}</b> {(item as ApiOperation).path}</code> : <><strong>{surface?.name}</strong><small>{surface?.packageName} · {surface?.kind}</small><button className="preview-button" onClick={() => setPreview(surface)}><Eye size={14} /> {surface?.stories.length ? `${surface.stories.length} visual ${surface.stories.length === 1 ? 'state' : 'states'}` : 'Visual reference'}</button></>}</div><div className="matrix-expectations">{rows.map(row => <div key={row.id}><span>{row.label}</span><small>{row.rule}</small></div>)}</div><div className="matrix-states">{rows.map(row => row.coverage === 'gap' ? <button key={row.id} className="gap-button state-gap" onClick={event => { trigger.current = event.currentTarget; setSelection({ subject: item, expectationId: row.id }) }} aria-label={`Gap: ${row.label}. Show ${rows.filter(candidate => candidate.coverage === 'gap').length} tests to add.`}>Gap <ChevronRight size={14} /></button> : <StatusPill key={row.id} state={row.coverage} />)}</div></div> })}{!filtered.length && <div className="empty-state roomy"><FileCode2 /><strong>No catalog entries match</strong><span>Adjust the filter or scan a repository.</span></div>}</div>{selection && <GapPlanDrawer subject={selection.subject} repository={repositories.find(item => item.id === selection.subject.repositoryId)} expectations={expectations.filter(item => item.subjectId === selection.subject.id)} selectedId={selection.expectationId} onClose={closePlan} />}{preview && <ComponentPreviewDrawer surface={preview} repository={repositories.find(item => item.id === preview.repositoryId)} onClose={() => setPreview(undefined)} />}</>
}

function CatalogPage({ type, data }: { type: 'api' | 'frontend'; data: Portfolio }) {
  const isApi = type === 'api'
  const expectations = data.expectations.filter(item => item.subjectType === (isApi ? 'api-operation' : 'frontend-surface'))
  const items: Array<ApiOperation | FrontendSurface> = isApi ? data.operations : data.surfaces
  return <><PageHeading eyebrow={isApi ? 'Contract inventory' : 'Implemented surface'} title={isApi ? 'API coverage matrix' : 'Frontend coverage matrix'} detail={isApi ? 'Every operation measured against schema-derived test expectations.' : 'Routes, pages, components, states, Storybook documentation, and test evidence.'} action={<div className="header-badge">{isApi ? <Braces /> : <Code2 />} {items.length} indexed</div>} /><CoverageRail expectations={expectations} /><Matrix items={items} expectations={expectations} kind={type} repositories={data.repositories} /></>
}

function ApiCatalogPage({ data }: { data: Portfolio }) {
  const [repositoryId, setRepositoryId] = useState('')
  const [tag, setTag] = useState('')
  const [coverage, setCoverage] = useState<CoverageState | ''>('')
  const apiExpectations = data.expectations.filter(item => item.subjectType === 'api-operation')
  const tags = [...new Set(data.operations.flatMap(operation => operation.tags))].sort()
  const operations = data.operations.filter(operation => {
    const expectations = apiExpectations.filter(item => item.subjectId === operation.id)
    return (!repositoryId || operation.repositoryId === repositoryId) &&
      (!tag || operation.tags.includes(tag)) &&
      (!coverage || expectations.some(item => item.coverage === coverage))
  })
  const visibleIds = new Set(operations.map(operation => operation.id))
  const expectations = apiExpectations.filter(item => visibleIds.has(item.subjectId))
  const findings = data.findings.filter(item =>
    item.status === 'open' &&
    (visibleIds.has(item.subjectId ?? '') || (!item.subjectId && operations.some(operation => operation.repositoryId === item.repositoryId)))
  )
  const summary = coverageSummary(expectations)
  return <>
    <PageHeading
      eyebrow="Contract inventory / authoritative snapshot"
      title="API coverage matrix"
      detail="Every operation measured against schema-derived expectations, accepted test evidence, and actionable contract findings."
      action={<div className="header-badge"><Braces /> {operations.length} operations</div>}
    />
    <section className="stats-grid compact-stats" aria-label="API coverage totals">
      <Stat label="Coverage" value={`${summary.percent}%`} detail={`${summary.covered} of ${summary.total} expectations`} />
      <Stat label="Required gaps" value={summary.gaps} detail="without accepted evidence" tone="danger" />
      <Stat label="Open findings" value={findings.length} detail="contract and coverage actions" tone={findings.length ? 'danger' : 'neutral'} />
      <Stat label="Revision set" value={data.repositories.filter(repository => repository.lastScanRevision).length} detail="scanned repositories represented" />
    </section>
    <div className="catalog-filters" aria-label="API catalog filters">
      <label>Repository<select value={repositoryId} onChange={event => setRepositoryId(event.target.value)}><option value="">All repositories</option>{data.repositories.map(repository => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</select></label>
      <label>Tag<select value={tag} onChange={event => setTag(event.target.value)}><option value="">All tags</option>{tags.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Coverage<select value={coverage} onChange={event => setCoverage(event.target.value as CoverageState | '')}><option value="">All states</option>{Object.entries(coverageLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="snapshot-stamp"><span>Policy</span><strong>api-coverage-v1</strong><small>{data.repositories.filter(repository => repository.lastScanAt).length} fresh scan snapshots</small></div>
    </div>
    <CoverageRail expectations={expectations} />
    <Matrix items={operations} expectations={expectations} kind="api" repositories={data.repositories} />
    <section className="panel catalog-findings">
      <div className="panel-heading"><div><p className="eyebrow">Remediation queue</p><h2>OpenAPI quality and coverage findings</h2></div><span className="header-badge"><AlertTriangle /> {findings.length}</span></div>
      <div className="finding-list">
        {findings.map(finding => <article className="finding-row finding-action" key={finding.id}>
          <AlertTriangle size={17} />
          <div><strong>{finding.title}</strong><small>{finding.detail}</small>{finding.remediation && <p><b>Next:</b> {finding.remediation}</p>}</div>
          <div className="finding-owner"><span className={`severity severity-${finding.severity}`}>{finding.severity}</span><small>{finding.owner ?? 'Unassigned'}</small></div>
        </article>)}
        {!findings.length && <div className="empty-state"><ShieldCheck /><strong>No findings in this view</strong><span>Adjust filters or scan another repository.</span></div>}
      </div>
    </section>
  </>
}

function Requirements({ data }: { data: Portfolio }) {
  return <><PageHeading eyebrow="Product intent" title="Requirements & inferred flows" detail="Jira stays authoritative. AI proposals remain visibly separate until reviewed." /><div className="requirements-grid">{data.requirements.map(requirement => { const flows = data.flows.filter(flow => flow.requirementId === requirement.id); const suggestions = data.suggestions.filter(item => item.requirementId === requirement.id && item.state === 'proposed'); return <article className="requirement-card" key={requirement.id}><div className="requirement-key">{requirement.jiraKey}</div><span className="issue-type">{requirement.issueType}</span><h3>{requirement.summary}</h3><p>{requirement.description}</p><div className="requirement-meta"><span><CircleDot /> {requirement.status}</span><span><Network /> {flows.length} confirmed flows</span><span><Sparkles /> {suggestions.length} proposals</span></div></article>})}</div></>
}

function ReviewQueue({ data, reload }: { data: Portfolio; reload: () => Promise<void> }) {
  const proposals = data.suggestions.filter(item => item.state === 'proposed')
  async function decide(id: string, decision: 'confirm' | 'reject') { await api.decideSuggestion(id, decision); await reload() }
  return <><PageHeading eyebrow="Human-in-the-loop" title="AI review queue" detail="Evidence-backed proposals never affect authoritative coverage until you decide." /><div className="review-list">{proposals.map(item => { const requirement = data.requirements.find(req => req.id === item.requirementId); return <article className="review-card" key={item.id}><div className="confidence"><Sparkles /><strong>{Math.round(item.confidence * 100)}%</strong><span>confidence</span></div><div className="review-body"><div className="review-context"><span>{requirement?.jiraKey ?? 'Unknown story'}</span><ChevronRight size={14} /><span>{item.type}</span></div><h3>{item.title}</h3><div className="evidence-list">{item.evidence.map(evidence => <blockquote key={evidence}>“{evidence}”</blockquote>)}</div></div><div className="review-actions"><button className="reject-button" onClick={() => decide(item.id, 'reject')}><X size={16} /> Reject</button><button className="confirm-button" onClick={() => decide(item.id, 'confirm')}><Check size={16} /> Confirm</button></div></article>})}{!proposals.length && <div className="empty-state roomy"><ShieldCheck /><strong>Review queue cleared</strong><span>New semantic proposals will appear after Jira analysis.</span></div>}</div></>
}

function OrganizationAdministration({ organizations }: { organizations: OrganizationQualitySummary[] }) {
  const [query, setQuery] = useState('')
  const [context, setContext] = useState<AdminTenantContext>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const visible = organizations.filter(item => item.organizationId.toLowerCase().includes(query.toLowerCase()))
  async function enter(organizationId: string) {
    setBusy(organizationId)
    setError('')
    try {
      setContext(await api.enterOrganizationContext(organizationId, 'Platform QA portfolio review'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }
  const contextSummary = context ? coverageSummary(context.portfolio.expectations) : undefined
  return <>
    {context && <div className="tenant-context-banner" role="status">
      <LockKeyhole size={17} />
      <div><strong>Read-only organization context</strong><span>{context.organizationId} · audited as {context.auditId.slice(0, 8)}</span></div>
      <button className="secondary-button" onClick={() => setContext(undefined)}><LogOut size={15} /> Exit context</button>
    </div>}
    <PageHeading
      eyebrow="Platform administration"
      title={context ? `Organization ${context.organizationId}` : 'Organization QA portfolio'}
      detail={context ? 'This audited context exposes QA evidence only. Repository, integration, and review mutations remain unavailable.' : 'Compare inventory freshness, coverage, gaps, and scan health across organizations.'}
      action={<div className="header-badge"><Building2 /> {organizations.length} organizations</div>}
    />
    {error && <div className="error-banner"><AlertTriangle /><div><strong>Organization context unavailable</strong><span>{error}</span></div></div>}
    {context && contextSummary ? <section className="stats-grid" aria-label="Selected organization totals">
      <Stat label="Repositories" value={context.portfolio.repositories.length} detail="read-only sources" />
      <Stat label="API operations" value={context.portfolio.operations.length} detail="cataloged contracts" />
      <Stat label="Frontend surfaces" value={context.portfolio.surfaces.length} detail="routes and components" />
      <Stat label="Coverage" value={`${contextSummary.percent}%`} detail={`${contextSummary.gaps} gaps`} tone={contextSummary.gaps ? 'danger' : 'neutral'} />
    </section> : <>
      <div className="filter-bar"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter organizations…" /><span>{visible.length} shown</span></div>
      <div className="organization-table">
        <div className="organization-table-head"><span>Organization</span><span>Inventory</span><span>Coverage</span><span>Risk</span><span /></div>
        {visible.map(item => <article key={item.organizationId}>
          <div><strong>{item.organizationId}</strong><small>{item.latestScanAt ? `Latest scan ${new Date(item.latestScanAt).toLocaleString()}` : 'No completed scan'}</small></div>
          <div><b>{item.repositories}</b><small>{item.apiOperations} APIs · {item.frontendSurfaces} UI · {item.tests} tests</small></div>
          <div><b>{item.coveragePercent}%</b><small>{item.coveredExpectations} / {item.expectations} expectations</small></div>
          <div className={item.gaps || item.failedScans ? 'organization-risk' : ''}><b>{item.gaps} gaps</b><small>{item.openFindings} findings · {item.failedScans} failed · {item.staleScans} stale</small></div>
          <button className="secondary-button" disabled={busy === item.organizationId} onClick={() => enter(item.organizationId)}><LockKeyhole size={14} /> Review</button>
        </article>)}
        {!visible.length && <div className="empty-state"><Building2 /><strong>No organizations match</strong><span>Adjust the filter or onboard a tenant repository.</span></div>}
      </div>
    </>}
  </>
}

function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) { return <header className="page-header compact"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="lede">{detail}</p></div>{action}</header> }

export function App() {
  const [view, setView] = useState<View>('overview')
  const [data, setData] = useState<Portfolio | null>(null)
  const [error, setError] = useState<string>()
  const [organizations, setOrganizations] = useState<OrganizationQualitySummary[]>()
  const [loading, setLoading] = useState(true)
  async function reload() {
    setLoading(true)
    try {
      setData(await api.portfolio())
      setError(undefined)
      try { setOrganizations(await api.platformOrganizations()) } catch { setOrganizations(undefined) }
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [])
  const visibleNavigation = useMemo(() => navigation.filter(item => item.id !== 'administration' || organizations), [organizations])
  const active = useMemo(() => visibleNavigation.find(item => item.id === view), [view, visibleNavigation])
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-symbol"><span /><span /><span /></div><div><strong>FuzeQuality</strong><small>Evidence control</small></div></div><nav>{visibleNavigation.map(item => { const Icon = item.icon; const count = item.id === 'review' ? data?.suggestions.filter(s => s.state === 'proposed').length : undefined; return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><Icon size={18} /><span>{item.label}</span>{count ? <b>{count}</b> : null}</button> })}</nav><div className="sidebar-footer"><Database size={16} /><div><span>Catalog revision</span><strong>{data ? 'live / v1' : 'connecting'}</strong></div></div></aside><main><div className="topbar"><span>{active?.label}</span><div><span className="live-dot" /> default branches <button className="icon-button" onClick={() => reload()} aria-label="Reload"><RefreshCw size={15} className={loading ? 'spin' : ''} /></button></div></div><div className="content">{error && <div className="error-banner"><AlertTriangle /> <div><strong>Catalog API unavailable</strong><span>{error}</span></div></div>}{!data ? <div className="loading-screen"><RefreshCw className="spin" /><span>Loading evidence graph…</span></div> : <>{view === 'overview' && <Overview data={data} onNavigate={setView} />}{view === 'repositories' && <Repositories data={data} reload={reload} />}{view === 'api' && <ApiCatalogPage data={data} />}{view === 'frontend' && <CatalogPage type="frontend" data={data} />}{view === 'requirements' && <Requirements data={data} />}{view === 'review' && <ReviewQueue data={data} reload={reload} />}{view === 'administration' && organizations && <OrganizationAdministration organizations={organizations} />}</>}</div></main></div>
}
