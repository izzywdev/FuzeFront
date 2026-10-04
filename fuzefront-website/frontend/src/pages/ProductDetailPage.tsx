import React from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Layers, Shield, Server, ClipboardList, Palette, Bot,
  Key, MessageSquare, CheckCircle2, Rocket, ArrowRight, ArrowLeft
} from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

interface ProductData {
  slug: string
  icon: React.ElementType
  name: string
  tagline: string
  heroDescription: string
  gradient: string
  features: Array<{ title: string; description: string }>
  useCases: string[]
  ctaText: string
}

const productData: Record<string, ProductData> = {
  fuzefront: {
    slug: 'fuzefront',
    icon: Layers,
    name: 'FuzeFront',
    tagline: 'The portal for your software factory',
    heroDescription: 'FuzeFront is the Module-Federation host shell and portal for the whole product family — the front door your team and customers actually use. Enterprise authentication (Authentik/OAuth2), fine-grained authorization (Permit.io), and the FuzeSDLC governance framework are built directly in, so every product inherits the same auth, design system, and delivery standards.',
    gradient: 'from-blue-500 to-cyan-500',
    features: [
      { title: 'Enterprise Authentication', description: 'Authentik-powered SSO with OAuth2, OpenID Connect, SAML, and LDAP. Multi-tenant identity with organization context on every request.' },
      { title: 'Fine-grained Authorization', description: 'Permit.io RBAC with attribute-based policies. Define roles, resources, and actions declaratively — enforced at the edge.' },
      { title: 'Built-in Governance', description: "FuzeSDLC's agentic delivery standard ships inside the portal — every connected product inherits the same gates and review discipline." },
      { title: 'Module Federation Host', description: 'Runtime microfrontend loading with zero build-time dependencies. Load any remote app by URL, share React singletons, and hot-swap remotes without a rebuild.' },
      { title: 'Plugin Marketplace', description: 'Frontend and backend plugin system. Ship capabilities as plugins, discover community extensions, and control what each tenant can activate.' },
      { title: 'Shared Design System', description: 'One design-system base every federated product extends, so the whole factory looks and behaves like one product.' },
    ],
    useCases: [
      'Multi-tenant SaaS products needing enterprise auth from day one',
      'Platform teams building a federated microfrontend shell',
      'Organizations standardizing auth, design, and delivery across many products',
      'Engineering teams replacing weeks of auth boilerplate',
    ],
    ctaText: 'Start building',
  },
  fuzesdlc: {
    slug: 'fuzesdlc',
    icon: Shield,
    name: 'FuzeSDLC',
    tagline: 'The governance layer behind every product',
    heroDescription: "FuzeSDLC defines the agentic software-delivery-lifecycle standard the entire factory runs on — single-responsibility agents, contract-first fan-out, design-first UI gates, and signed, gated merges. It isn't a separate app you log into; its governance is embedded directly into FuzeFront and enforced across every repo in the family.",
    gradient: 'from-slate-600 to-slate-800',
    features: [
      { title: 'Baseline + Repo Overlay', description: 'A shared governance baseline every repo extends, with repo-specific overlays for what makes that product different.' },
      { title: 'Single-responsibility Agents', description: 'A canonical roster of specialized agents — one per concern — instead of one generalist doing everything.' },
      { title: 'Contract-first Fan-out', description: 'API and UX contracts are frozen before implementation starts, so backend, frontend, and tests build in parallel against one source of truth.' },
      { title: 'CI Governance Gates', description: 'Design-first, authorization, identifier, and frames-first gates that block a merge rather than rely on a reviewer remembering to check.' },
      { title: 'Signed, Gated Releases', description: 'Every release is signed and passes the full gate set before it ships — no human has to be the safety net.' },
      { title: 'Cross-repo Delegation', description: 'A standard way for one repo to hand work to another via @claude delegation, instead of ad-hoc coordination.' },
    ],
    useCases: [
      'Engineering orgs standardizing how AI agents build software',
      'Platform teams enforcing consistent quality gates across many repos',
      'Teams that need auditable, gated delivery instead of ad-hoc AI-assisted commits',
      'Multi-repo product families needing one shared rulebook',
    ],
    ctaText: 'See the standard',
  },
  fuzeinfra: {
    slug: 'fuzeinfra',
    icon: Server,
    name: 'FuzeInfra',
    tagline: 'The infrastructure layer everything runs on',
    heroDescription: 'FuzeInfra is the shared, containerized infrastructure platform for the whole family — Postgres, Redis, Neo4j, Elasticsearch, Kafka, and Prometheus/Grafana/Loki — deployed consistently to local clusters, staging, and production via Helm and GitOps.',
    gradient: 'from-cyan-600 to-blue-700',
    features: [
      { title: 'Shared Data Stores', description: 'Postgres, MongoDB, Redis, Neo4j, Elasticsearch, and ChromaDB provisioned the same way for every product.' },
      { title: 'Event Streaming', description: 'Kafka and RabbitMQ for reliable, ordered event delivery between services and products.' },
      { title: 'Observability Stack', description: 'Prometheus metrics, Grafana dashboards, and Loki logs wired up by default — not bolted on after an incident.' },
      { title: 'GitOps Deploys', description: 'Helm charts and ArgoCD applications so infrastructure changes ship through the same review and merge process as code.' },
      { title: 'Environment Parity', description: 'The same infrastructure definitions run in local kind clusters, staging, and production — no surprises at promotion time.' },
      { title: 'Shared Networking', description: 'Consistent DNS, service discovery, and ingress across the whole family via Consul and dnsmasq.' },
    ],
    useCases: [
      'Platform teams standardizing infrastructure across many services',
      'Products needing production-grade data stores without building their own ops',
      'Teams that want the same infrastructure locally and in production',
      'Organizations running GitOps-only deployments',
    ],
    ctaText: 'Build on solid ground',
  },
  fuzeplan: {
    slug: 'fuzeplan',
    icon: ClipboardList,
    name: 'FuzePlan',
    tagline: 'Product management, wired into Jira',
    heroDescription: 'FuzePlan turns product requirements into well-formed, tracked work — tickets, sprints, and status reports that stay in sync with Jira and Confluence, so planning and delivery never drift apart.',
    gradient: 'from-amber-500 to-orange-600',
    features: [
      { title: 'Jira & Confluence Integration', description: 'Tickets, epics, and docs stay in sync with your existing Atlassian workspace instead of living in a second system.' },
      { title: 'Ticket Lifecycle Management', description: 'From backlog to done, with the right ticket type, fields, and transitions enforced automatically.' },
      { title: 'Sprint Planning & Grooming', description: 'Structured backlog grooming and sprint planning that keeps scope realistic and visible.' },
      { title: 'Status Reporting', description: 'Live status reports for stakeholders without a manual round of "what did everyone do this week."' },
      { title: 'Ticket-quality Enforcement', description: 'Automated checks that a ticket has what it needs — acceptance criteria, owner, priority — before work starts.' },
      { title: 'Cross-repo Coordination', description: 'Plans work that spans multiple repos and teams without losing track of dependencies.' },
    ],
    useCases: [
      'Product teams keeping planning and delivery in sync',
      'Engineering managers needing live sprint and status visibility',
      'Teams standardizing ticket quality across a backlog',
      'Organizations coordinating work across multiple repos and teams',
    ],
    ctaText: 'Plan with clarity',
  },
  fuzex: {
    slug: 'fuzex',
    icon: Palette,
    name: 'FuzeX',
    tagline: 'UX/UI design & flow approvals',
    heroDescription: 'FuzeX owns UX/UI design and flow approval for the whole factory. Every feature starts as navigable HTML frames — not a mockup tool nobody checks into git — reviewed and approved per-flow before a single line of UI code ships.',
    gradient: 'from-fuchsia-500 to-pink-600',
    features: [
      { title: 'Navigable Design Frames', description: 'Frames are code: version-controlled, diffable HTML screens that show every state, not just the happy path.' },
      { title: 'Per-flow Approval', description: 'One ready flow never waits on an unready sibling — approve and ship flow by flow.' },
      { title: 'Design-to-code Build Inventory', description: 'Approved frames declare the components and packages implementation must build, so code can\'t quietly diverge from the design.' },
      { title: 'Frame-first CI Gate', description: 'A gate that blocks feature UI from shipping without an approved covering flow — no relying on someone remembering to check.' },
      { title: 'Cross-product Review Site', description: 'A navigable review site shared across products instead of a reviewer opening a dozen local HTML files.' },
      { title: 'Version History', description: 'Full history for every frame and design token, with diff and rollback.' },
    ],
    useCases: [
      'Product teams enforcing design-before-code',
      'Organizations that shipped UI with no design review and got burned',
      'Design systems teams keeping frames and components in sync',
      'Teams needing an audit trail from requirement to approved screen',
    ],
    ctaText: 'Bridge design and code',
  },
  fuzeagent: {
    slug: 'fuzeagent',
    icon: Bot,
    name: 'FuzeAgent',
    tagline: 'Agent orchestration',
    heroDescription: 'FuzeAgent orchestrates the fleet of specialized AI agents that build, test, and ship every product in the factory — contract-first fan-out, multi-agent pipelines, human-in-the-loop checkpoints, and full auditability on every decision.',
    gradient: 'from-violet-500 to-purple-600',
    features: [
      { title: 'Multi-agent Pipelines', description: 'Chain single-responsibility agents into pipelines with branching logic, parallel execution, and shared context passing.' },
      { title: 'Contract-first Fan-out', description: 'Backend, frontend, and test agents build in parallel against one frozen API/UX contract instead of serializing on each other.' },
      { title: 'Human-in-the-Loop', description: 'Insert human approval checkpoints anywhere in a workflow. Route decisions to Slack, email, or in-app queues.' },
      { title: 'Kafka Event Streaming', description: 'Event-driven agent triggers and outputs streamed through Kafka for reliable, ordered processing at scale.' },
      { title: 'Cost & Usage Tracking', description: 'Per-agent token usage, cost attribution by team or project, and budget guardrails to prevent runaway spend.' },
      { title: 'Full Audit Trail', description: 'Every agent decision, tool call, and human intervention is logged with timestamps, inputs, and outputs.' },
    ],
    useCases: [
      'Platform teams running many specialized agents instead of one generalist',
      'Organizations needing auditable, accountable AI-driven delivery',
      'Teams automating research, review, and delivery pipelines',
      'Orgs that need cost accountability on AI work',
    ],
    ctaText: 'Start orchestrating',
  },
  fuzekeys: {
    slug: 'fuzekeys',
    icon: Key,
    name: 'FuzeKeys',
    tagline: 'Identity management',
    heroDescription: "FuzeKeys is the identity layer for the family — SSO via Authentik, OAuth2/OIDC/SAML federation, and fine-grained authorization via Permit.io — so a user's identity and permissions carry seamlessly across every product in the factory.",
    gradient: 'from-orange-500 to-red-500',
    features: [
      { title: 'Authentik-powered SSO', description: 'Single sign-on across every product in the family, backed by Authentik.' },
      { title: 'Federation Standards', description: 'OAuth2, OpenID Connect, SAML, and LDAP support for connecting your existing identity provider.' },
      { title: 'Fine-grained Authorization', description: 'Permit.io policies define who can do what, down to the resource and action — enforced at the edge.' },
      { title: 'Multi-tenant Identity', description: 'Organization context travels with every request, so one identity works correctly across every tenant boundary.' },
      { title: 'Secrets Vaulting', description: 'Encrypted storage for API keys, database credentials, and tokens with versioning and rollback.' },
      { title: 'Full Access Audit Trail', description: 'Every authentication and authorization decision logged with user, time, and outcome — exportable for compliance.' },
    ],
    useCases: [
      'Multi-product platforms needing one identity across every app',
      'Enterprises requiring SSO/SAML from day one',
      'Teams replacing bespoke auth built separately per service',
      'Organizations needing a single source of truth for permissions',
    ],
    ctaText: 'Unify your identity',
  },
  fuzepicker: {
    slug: 'fuzepicker',
    icon: MessageSquare,
    name: 'FuzePicker',
    tagline: 'Production UX analysis & discussion',
    heroDescription: 'FuzePicker captures real production UX — session flows, friction points, drop-offs — and turns it into a shared space for the team to review and discuss what to fix next. It closes the loop between what you shipped and what users actually do with it.',
    gradient: 'from-teal-500 to-emerald-600',
    features: [
      { title: 'Production UX Analysis', description: 'Real session flows and interaction data from production, not a lab study or a guess.' },
      { title: 'Friction & Drop-off Detection', description: 'Automatically surfaces where users hesitate, backtrack, or abandon a flow.' },
      { title: 'Shared Discussion Threads', description: 'Attach discussion directly to a flow or screen so the whole team reasons about the same evidence.' },
      { title: 'Flow Replay', description: 'Replay an actual user session to see exactly what happened, not a reconstruction from a support ticket.' },
      { title: 'Prioritized Findings', description: 'Findings ranked by impact and frequency, so the next fix is the one that matters most.' },
      { title: 'Hand-off to FuzeX', description: 'Turn a validated UX finding directly into a redesign request FuzeX can pick up.' },
    ],
    useCases: [
      'Product teams deciding what to fix next from real usage, not opinions',
      'UX researchers who need evidence before proposing a redesign',
      'Teams closing the loop between shipped UI and actual user behavior',
      'Organizations prioritizing a redesign backlog with data',
    ],
    ctaText: 'See how it\'s really used',
  },
  fuzequality: {
    slug: 'fuzequality',
    icon: CheckCircle2,
    name: 'FuzeQuality',
    tagline: 'Automated UI/UX test coverage',
    heroDescription: "FuzeQuality runs the automated UI and UX test coverage across every product — Playwright-driven visual regression, accessibility and contrast checks, and console-clean runtime validation — so UI regressions get caught before they ship, not after.",
    gradient: 'from-lime-500 to-green-600',
    features: [
      { title: 'Playwright Regression Suites', description: 'Automated UI/UX test suites that run against every change, pre- and post-production.' },
      { title: 'WCAG Contrast & Accessibility', description: 'Pixel-based contrast checks and accessibility audits built into the same suite, not a separate afterthought.' },
      { title: 'Console-clean Runtime Validation', description: 'Every UI change is rendered in a real browser and checked for runtime errors, failed requests, and CSP violations.' },
      { title: 'Mobile/Responsive Coverage', description: 'Device-emulation tests that catch tap-target and layout regressions across real device profiles.' },
      { title: 'Cross-repo Coverage Tracking', description: 'A unified view of UI test coverage across every repo in the family, with trends over time.' },
      { title: 'CI Quality Gates', description: 'Configurable pass/fail thresholds that block a merge or release when UI quality regresses.' },
    ],
    useCases: [
      'Teams that need UI regressions caught in CI, not by users',
      'Organizations enforcing accessibility standards on every release',
      'Platform teams tracking UI test coverage across many repos',
      'Orgs that want a quality gate before every release, not after an incident',
    ],
    ctaText: 'Ship with confidence',
  },
  fuzedeploy: {
    slug: 'fuzedeploy',
    icon: Rocket,
    name: 'FuzeDeploy',
    tagline: 'Multi-cloud CI/CD automation',
    heroDescription: 'FuzeDeploy automates CI/CD for the whole factory — build, test, sign, and release pipelines that deploy the same way across AWS, GCP, Azure, and on-prem Kubernetes, so no product has to reinvent its own release process.',
    gradient: 'from-indigo-500 to-purple-700',
    features: [
      { title: 'Multi-cloud Pipelines', description: 'The same CI/CD pipeline definition deploys to AWS, GCP, Azure, or on-prem Kubernetes without a rewrite per target.' },
      { title: 'GitOps Deploys', description: 'Helm charts and ArgoCD Applications drive every deploy — the cluster state always matches what\'s merged.' },
      { title: 'Signed, Gated Releases', description: 'Every release is signed and must pass the full gate set (tests, security, contract validation) before it ships.' },
      { title: 'Auto-merge on Green', description: 'A PR that clears every gate merges and deploys without waiting on a human to click a button.' },
      { title: 'Environment Parity', description: 'The same pipeline runs against local, staging, and production, so promotion never surfaces a new class of bug.' },
      { title: 'Rollback & Release History', description: 'Full release history with one-step rollback when a deploy needs to be undone.' },
    ],
    useCases: [
      'Teams needing one release process across multiple clouds',
      'Platform teams standardizing CI/CD across many repos',
      'Organizations requiring signed, auditable releases',
      'Orgs moving from manual deploys to GitOps',
    ],
    ctaText: 'Automate your releases',
  },
}

export const ProductDetailPage: React.FC = () => {
  const { productSlug } = useParams<{ productSlug: string }>()
  const { trackEvent } = useAnalytics()

  if (!productSlug || !productData[productSlug]) {
    return <Navigate to="/products" replace />
  }

  const product = productData[productSlug]
  const Icon = product.icon

  return (
    <div>
      {/* Hero */}
      <section className={`bg-gradient-to-br ${product.gradient} pt-28 pb-20 relative overflow-hidden`}>
        <div className="absolute inset-0 hero-pattern opacity-20" />
        {/* Scrim: several of the per-product gradients (blue-500, pink-500,
            lime-500, amber-500, teal-500, etc.) are bright/saturated enough
            that white text at normal (non-"large") sizes can't reach 4.5:1
            against them even at full opacity — caught by e2e/contrast.spec.ts
            once routes.ts started covering every product page instead of
            just /products/fuzefront. black/30 wasn't dark enough for the
            lightest stops (lime/teal/amber); black/45 clears all ten. */}
        <div className="absolute inset-0 bg-black/45" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Link
              to="/products"
              className="inline-flex items-center gap-1 text-white/90 hover:text-white text-sm mb-8 transition-colors"
            >
              <ArrowLeft size={14} /> All products
            </Link>

            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
                <Icon size={30} className="text-white" />
              </div>
              <div>
                <h1 className="text-3xl sm:text-4xl font-heading font-extrabold text-white">
                  {product.name}
                </h1>
                <p className="text-white/90 text-lg mt-1">{product.tagline}</p>
              </div>
            </div>

            <p className="text-white text-lg leading-relaxed max-w-2xl mb-8">
              {product.heroDescription}
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <a
                href="https://app.fuzefront.com/signup"
                className="inline-flex items-center justify-center gap-2 bg-white text-gray-900 font-semibold px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors"
                onClick={() => trackEvent('cta_click', { button: 'product_start', product: product.slug })}
              >
                {product.ctaText} <ArrowRight size={16} />
              </a>
              <Link
                to="/contact"
                className="inline-flex items-center justify-center gap-2 border-2 border-white/40 text-white font-medium px-6 py-3 rounded-lg hover:bg-white/10 transition-colors"
                onClick={() => trackEvent('cta_click', { button: 'product_contact', product: product.slug })}
              >
                Talk to sales
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-heading font-bold text-gray-900 mb-12 text-center">
            Key capabilities
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {product.features.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.45 }}
                className="flex gap-4"
              >
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${product.gradient} flex-shrink-0 flex items-center justify-center shadow-sm`}>
                  <CheckCircle2 size={16} className="text-white" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1">{feature.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{feature.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className="py-16 bg-secondary-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-heading font-bold text-gray-900 mb-8 text-center">
            Built for teams who need to
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {product.useCases.map((useCase) => (
              <div key={useCase} className="flex items-start gap-3 bg-white rounded-xl border border-gray-100 p-5">
                <CheckCircle2 size={18} className="text-success-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-gray-700 leading-relaxed">{useCase}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-white border-t border-gray-100">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <h2 className="text-2xl sm:text-3xl font-heading font-bold text-gray-900 mb-4">
            Ready to get started with {product.name}?
          </h2>
          <p className="text-gray-600 mb-8">
            Try free for 14 days. No credit card required.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <a
              href="https://app.fuzefront.com/signup"
              className="btn-primary flex items-center justify-center gap-2"
              onClick={() => trackEvent('cta_click', { button: 'product_detail_start', product: product.slug })}
            >
              {product.ctaText} <ArrowRight size={16} />
            </a>
            <Link to="/pricing" className="btn-secondary">
              Compare plans
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
