import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  Database,
  FileCode2,
  GitBranch,
  Layers3,
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
  CoverageState,
  FrontendSurface,
  Portfolio,
  TestExpectation,
} from '@fuzequality/contracts'
import { api } from './api'

type View = 'overview' | 'repositories' | 'api' | 'frontend' | 'requirements' | 'review'

const navigation: Array<{ id: View; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Portfolio', icon: Activity },
  { id: 'repositories', label: 'Repositories', icon: GitBranch },
  { id: 'api', label: 'API catalog', icon: Braces },
  { id: 'frontend', label: 'Frontend inventory', icon: Layers3 },
  { id: 'requirements', label: 'Requirements & flows', icon: Network },
  { id: 'review', label: 'AI review queue', icon: Sparkles },
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
  const [form, setForm] = useState({ owner: 'izzywdev', name: '', defaultBranch: 'main', kind: 'mixed', localPath: '' })
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      await api.addRepository({ ...form, includeGlobs: [], excludeGlobs: [], jiraProjects: [] })
      setOpen(false); await reload()
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
        {data.repositories.map(repository => (
          <article className="repo-card" key={repository.id}>
            <div className="repo-card-top"><div className="repo-mark large">{repository.name.slice(0, 2).toUpperCase()}</div><span className={`scan-status scan-${repository.lastScanStatus}`}>{repository.lastScanStatus}</span></div>
            <h3>{repository.name}</h3><p>{repository.canonicalUrl}</p>
            <dl><div><dt>Branch</dt><dd>{repository.defaultBranch}</dd></div><div><dt>Kind</dt><dd>{repository.kind}</dd></div><div><dt>Last scan</dt><dd>{repository.lastScanAt ? new Date(repository.lastScanAt).toLocaleString() : 'Never'}</dd></div></dl>
            <button className="secondary-button" disabled={busy} onClick={() => scan(repository.id, repository.localPath)}><RefreshCw size={15} /> Scan now</button>
          </article>
        ))}
      </section>
      {open && <div className="modal-backdrop" role="presentation"><form className="modal" onSubmit={submit}><div className="modal-title"><div><p className="eyebrow">GitHub App source</p><h2>Add repository</h2></div><button type="button" className="icon-button" onClick={() => setOpen(false)}><X /></button></div><label>Owner<input value={form.owner} onChange={event => setForm({ ...form, owner: event.target.value })} required /></label><label>Repository name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="FuzeService" required /></label><div className="form-row"><label>Default branch<input value={form.defaultBranch} onChange={event => setForm({ ...form, defaultBranch: event.target.value })} /></label><label>Kind<select value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value })}><option value="mixed">Mixed</option><option value="service">Service</option><option value="application">Application</option><option value="library">Library</option><option value="infrastructure">Infrastructure</option></select></label></div><label>Local path <small>(development only)</small><input value={form.localPath} onChange={event => setForm({ ...form, localPath: event.target.value })} placeholder="D:\source\FuzeService" /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Adding…' : 'Add repository'}</button></div></form></div>}
    </>
  )
}

function Matrix({ items, expectations, kind }: { items: Array<ApiOperation | FrontendSurface>; expectations: TestExpectation[]; kind: 'api' | 'frontend' }) {
  const [query, setQuery] = useState('')
  const filtered = items.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()))
  return <><div className="filter-bar"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Filter ${kind === 'api' ? 'operations' : 'surfaces'}…`} /><span>{filtered.length} shown</span></div><div className="matrix"><div className="matrix-head"><span>{kind === 'api' ? 'Operation' : 'Surface'}</span><span>Expected evidence</span><span>Status</span></div>{filtered.map(item => { const rows = expectations.filter(expectation => expectation.subjectId === item.id); return <div className="matrix-group" key={item.id}><div className="matrix-subject">{kind === 'api' ? <code><b>{(item as ApiOperation).method.toUpperCase()}</b> {(item as ApiOperation).path}</code> : <><strong>{(item as FrontendSurface).name}</strong><small>{(item as FrontendSurface).packageName} · {(item as FrontendSurface).kind}</small></>}</div><div className="matrix-expectations">{rows.map(row => <div key={row.id}><span>{row.label}</span><small>{row.rule}</small></div>)}</div><div className="matrix-states">{rows.map(row => <StatusPill key={row.id} state={row.coverage} />)}</div></div> })}{!filtered.length && <div className="empty-state roomy"><FileCode2 /><strong>No catalog entries match</strong><span>Adjust the filter or scan a repository.</span></div>}</div></>
}

function CatalogPage({ type, data }: { type: 'api' | 'frontend'; data: Portfolio }) {
  const isApi = type === 'api'
  const expectations = data.expectations.filter(item => item.subjectType === (isApi ? 'api-operation' : 'frontend-surface'))
  const items: Array<ApiOperation | FrontendSurface> = isApi ? data.operations : data.surfaces
  return <><PageHeading eyebrow={isApi ? 'Contract inventory' : 'Implemented surface'} title={isApi ? 'API coverage matrix' : 'Frontend coverage matrix'} detail={isApi ? 'Every operation measured against schema-derived test expectations.' : 'Routes, pages, components, states, Storybook documentation, and test evidence.'} action={<div className="header-badge">{isApi ? <Braces /> : <Code2 />} {items.length} indexed</div>} /><CoverageRail expectations={expectations} /><Matrix items={items} expectations={expectations} kind={type} /></>
}

function Requirements({ data }: { data: Portfolio }) {
  return <><PageHeading eyebrow="Product intent" title="Requirements & inferred flows" detail="Jira stays authoritative. AI proposals remain visibly separate until reviewed." /><div className="requirements-grid">{data.requirements.map(requirement => { const flows = data.flows.filter(flow => flow.requirementId === requirement.id); const suggestions = data.suggestions.filter(item => item.requirementId === requirement.id && item.state === 'proposed'); return <article className="requirement-card" key={requirement.id}><div className="requirement-key">{requirement.jiraKey}</div><span className="issue-type">{requirement.issueType}</span><h3>{requirement.summary}</h3><p>{requirement.description}</p><div className="requirement-meta"><span><CircleDot /> {requirement.status}</span><span><Network /> {flows.length} confirmed flows</span><span><Sparkles /> {suggestions.length} proposals</span></div></article>})}</div></>
}

function ReviewQueue({ data, reload }: { data: Portfolio; reload: () => Promise<void> }) {
  const proposals = data.suggestions.filter(item => item.state === 'proposed')
  async function decide(id: string, decision: 'confirm' | 'reject') { await api.decideSuggestion(id, decision); await reload() }
  return <><PageHeading eyebrow="Human-in-the-loop" title="AI review queue" detail="Evidence-backed proposals never affect authoritative coverage until you decide." /><div className="review-list">{proposals.map(item => { const requirement = data.requirements.find(req => req.id === item.requirementId); return <article className="review-card" key={item.id}><div className="confidence"><Sparkles /><strong>{Math.round(item.confidence * 100)}%</strong><span>confidence</span></div><div className="review-body"><div className="review-context"><span>{requirement?.jiraKey ?? 'Unknown story'}</span><ChevronRight size={14} /><span>{item.type}</span></div><h3>{item.title}</h3><div className="evidence-list">{item.evidence.map(evidence => <blockquote key={evidence}>“{evidence}”</blockquote>)}</div></div><div className="review-actions"><button className="reject-button" onClick={() => decide(item.id, 'reject')}><X size={16} /> Reject</button><button className="confirm-button" onClick={() => decide(item.id, 'confirm')}><Check size={16} /> Confirm</button></div></article>})}{!proposals.length && <div className="empty-state roomy"><ShieldCheck /><strong>Review queue cleared</strong><span>New semantic proposals will appear after Jira analysis.</span></div>}</div></>
}

function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) { return <header className="page-header compact"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="lede">{detail}</p></div>{action}</header> }

export function App() {
  const [view, setView] = useState<View>('overview')
  const [data, setData] = useState<Portfolio | null>(null)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  async function reload() { setLoading(true); try { setData(await api.portfolio()); setError(undefined) } catch (value) { setError(value instanceof Error ? value.message : String(value)) } finally { setLoading(false) } }
  useEffect(() => { void reload() }, [])
  const active = useMemo(() => navigation.find(item => item.id === view), [view])
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-symbol"><span /><span /><span /></div><div><strong>FuzeQuality</strong><small>Evidence control</small></div></div><nav>{navigation.map(item => { const Icon = item.icon; const count = item.id === 'review' ? data?.suggestions.filter(s => s.state === 'proposed').length : undefined; return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><Icon size={18} /><span>{item.label}</span>{count ? <b>{count}</b> : null}</button> })}</nav><div className="sidebar-footer"><Database size={16} /><div><span>Catalog revision</span><strong>{data ? 'live / v1' : 'connecting'}</strong></div></div></aside><main><div className="topbar"><span>{active?.label}</span><div><span className="live-dot" /> default branches <button className="icon-button" onClick={() => reload()} aria-label="Reload"><RefreshCw size={15} className={loading ? 'spin' : ''} /></button></div></div><div className="content">{error && <div className="error-banner"><AlertTriangle /> <div><strong>Catalog API unavailable</strong><span>{error}</span></div></div>}{!data ? <div className="loading-screen"><RefreshCw className="spin" /><span>Loading evidence graph…</span></div> : <>{view === 'overview' && <Overview data={data} onNavigate={setView} />}{view === 'repositories' && <Repositories data={data} reload={reload} />}{view === 'api' && <CatalogPage type="api" data={data} />}{view === 'frontend' && <CatalogPage type="frontend" data={data} />}{view === 'requirements' && <Requirements data={data} />}{view === 'review' && <ReviewQueue data={data} reload={reload} />}</>}</div></main></div>
}
