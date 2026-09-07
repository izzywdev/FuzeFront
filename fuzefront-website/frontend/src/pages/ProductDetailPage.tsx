import React from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Layers, Bot, Globe, CreditCard, Key, TrendingUp,
  CheckCircle2, BarChart3, Palette, Monitor, ArrowRight, ArrowLeft
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
    name: 'FuzeFront Platform',
    tagline: 'The operating system for your SaaS',
    heroDescription: 'FuzeFront is the Module-Federation host shell that ships with enterprise authentication (Authentik/OAuth2), fine-grained RBAC (Permit.io), Stripe billing, a plugin marketplace, an AI assistant, and the shared infra every modern SaaS needs.',
    gradient: 'from-blue-500 to-cyan-500',
    features: [
      { title: 'Enterprise Authentication', description: 'Authentik-powered SSO with OAuth2, OpenID Connect, SAML, and LDAP. Multi-tenant identity with organization context on every request.' },
      { title: 'Fine-grained Authorization', description: 'Permit.io RBAC with attribute-based policies. Define roles, resources, and actions declaratively — enforced at the edge.' },
      { title: 'Built-in Billing', description: 'Stripe subscriptions, usage-based billing, invoice management, and a full customer portal — wired up and ready on day one.' },
      { title: 'Module Federation Host', description: 'Runtime microfrontend loading with zero build-time dependencies. Load any remote app by URL, share React singletons, and hot-swap remotes without a rebuild.' },
      { title: 'Plugin Marketplace', description: 'Frontend and backend plugin system. Ship capabilities as plugins, discover community extensions, and control what each tenant can activate.' },
      { title: 'AI Chat Assistant', description: 'GPT-powered assistant with context from your app, custom knowledge bases, and role-aware responses.' },
    ],
    useCases: [
      'Multi-tenant SaaS products needing enterprise auth from day one',
      'Platform teams building a federated microfrontend shell',
      'Products that need billing without building payment infra',
      'Engineering teams replacing weeks of auth/billing boilerplate',
    ],
    ctaText: 'Start building',
  },
  fuzeagent: {
    slug: 'fuzeagent',
    icon: Bot,
    name: 'FuzeAgent',
    tagline: 'AI team orchestration at scale',
    heroDescription: 'FuzeAgent lets you build and run autonomous AI agent workflows with multi-agent pipelines, human-in-the-loop checkpoints, and Kafka-backed event streaming — all with full auditability.',
    gradient: 'from-violet-500 to-purple-600',
    features: [
      { title: 'Multi-agent Pipelines', description: 'Chain agents into pipelines with branching logic, parallel execution, and shared context passing.' },
      { title: 'Human-in-the-Loop', description: 'Insert human approval checkpoints anywhere in a workflow. Route decisions to Slack, email, or in-app queues.' },
      { title: 'Kafka Event Streaming', description: 'Event-driven agent triggers and outputs streamed through Kafka for reliable, ordered processing at scale.' },
      { title: 'Agent Templates', description: 'Start from a library of pre-built agent templates for common workflows: research, summarization, code review, data extraction.' },
      { title: 'Cost & Usage Tracking', description: 'Per-agent token usage, cost attribution by team or project, and budget guardrails to prevent runaway spend.' },
      { title: 'Full Audit Trail', description: 'Every agent decision, tool call, and human intervention is logged with timestamps, inputs, and outputs.' },
    ],
    useCases: [
      'Automating research and content pipelines with AI agents',
      'Building approval workflows that mix AI and human judgment',
      'Processing high-volume events with reliable agent orchestration',
      'Teams that need AI automation with cost accountability',
    ],
    ctaText: 'Start automating',
  },
  fuzesocial: {
    slug: 'fuzesocial',
    icon: Globe,
    name: 'FuzeSocial',
    tagline: 'Every platform. One dashboard.',
    heroDescription: 'FuzeSocial lets your team schedule, publish, and analyze content across Facebook, Instagram, TikTok, YouTube, Reddit, X, and WhatsApp from a single unified dashboard with AI-generated content.',
    gradient: 'from-pink-500 to-rose-500',
    features: [
      { title: '7+ Social Platforms', description: 'Publish to Facebook, Instagram, TikTok, YouTube, Reddit, X (Twitter), and WhatsApp — all from one interface.' },
      { title: 'AI Content Generation', description: "AI-powered caption writing, hashtag suggestions, and image prompt generation tailored to each platform's tone." },
      { title: 'Cross-platform Scheduling', description: 'Visual content calendar with per-platform optimal timing recommendations and bulk scheduling.' },
      { title: 'Advanced Analytics', description: 'Unified engagement metrics, reach, impressions, and follower growth across all platforms in one view.' },
      { title: 'Team Collaboration', description: 'Draft, review, approve, and publish workflows with role-based access for agencies and brand teams.' },
      { title: 'Content Library', description: 'Centralized media library with asset reuse, resize-to-platform, and version history.' },
    ],
    useCases: [
      'Marketing teams managing multi-brand social presence',
      'Agencies running social for multiple clients',
      'Creators scaling content output across platforms',
      'Brands needing unified analytics across social channels',
    ],
    ctaText: 'Start posting smarter',
  },
  fuzefinance: {
    slug: 'fuzefinance',
    icon: CreditCard,
    name: 'FuzeFinance',
    tagline: 'Enterprise finance for modern businesses',
    heroDescription: 'FuzeFinance delivers invoicing, general ledger, multi-entity accounting, and automated payouts — built for the multi-currency, multi-entity reality of modern businesses.',
    gradient: 'from-green-500 to-emerald-600',
    features: [
      { title: 'Invoice Management', description: 'Create, send, and track invoices with automated reminders, partial payments, and dispute management.' },
      { title: 'General Ledger', description: 'Double-entry accounting with chart of accounts, journal entries, and period closing built for accountants.' },
      { title: 'Multi-entity Support', description: 'Manage finances across multiple legal entities with intercompany transfers and consolidated reporting.' },
      { title: 'Multi-currency', description: 'Transact in any currency with real-time FX rates, gain/loss tracking, and multi-currency reporting.' },
      { title: 'Financial Reporting', description: 'P&L, balance sheet, cash flow statements, and custom reports exportable to Excel, PDF, or accounting software.' },
      { title: 'Automated Payouts', description: 'Schedule and execute payouts to vendors, contractors, and partners with approval workflows.' },
    ],
    useCases: [
      'SaaS companies managing subscription revenue and payouts',
      'Multi-entity businesses needing consolidated reporting',
      'Finance teams replacing spreadsheets with structured accounting',
      'Marketplaces handling complex disbursements',
    ],
    ctaText: 'Simplify finance',
  },
  fuzekeys: {
    slug: 'fuzekeys',
    icon: Key,
    name: 'FuzeKeys',
    tagline: 'AI-powered credential management',
    heroDescription: 'FuzeKeys is a secrets vault, PII tokenizer, and API key manager with AI-powered anomaly detection and a complete audit trail for every credential access.',
    gradient: 'from-orange-500 to-amber-500',
    features: [
      { title: 'Secrets Vault', description: 'Encrypted storage for API keys, database credentials, tokens, and certificates with versioning and rollback.' },
      { title: 'PII Tokenization', description: 'Replace sensitive data (SSN, CC, email) with reversible tokens — send to any service without exposing the real value.' },
      { title: 'Automatic Key Rotation', description: 'Schedule and automate rotation for API keys, certificates, and database passwords with zero-downtime swap.' },
      { title: 'AI Anomaly Detection', description: 'ML-powered detection of unusual access patterns, credential misuse, and potential compromises in real time.' },
      { title: 'Full Audit Trail', description: 'Every credential read, write, and rotation logged with user, time, service, and reason — exportable for compliance.' },
      { title: 'Team Access Controls', description: 'Fine-grained access policies by team, environment, and secret type with just-in-time access grants.' },
    ],
    useCases: [
      'Engineering teams replacing plaintext .env files in CI/CD',
      'Security teams centralizing credential governance',
      'Products storing user PII that must stay out of logs and APIs',
      'Compliance-sensitive industries needing audit trails on every access',
    ],
    ctaText: 'Secure your secrets',
  },
  fuzemarket: {
    slug: 'fuzemarket',
    icon: TrendingUp,
    name: 'FuzeMarket',
    tagline: 'AI-powered SEO and marketing intelligence',
    heroDescription: 'FuzeMarket combines keyword strategy, content pipeline management, competitor tracking, and AI-powered SEO recommendations into one intelligence platform.',
    gradient: 'from-teal-500 to-cyan-500',
    features: [
      { title: 'Keyword Strategy Engine', description: 'Discover, cluster, and prioritize keywords by intent, difficulty, and business value with AI assistance.' },
      { title: 'Content Pipeline', description: 'Plan, brief, draft, review, and publish content with AI writing assistance and SEO scoring at every step.' },
      { title: 'Competitor Tracking', description: 'Monitor competitor content, rankings, backlinks, and strategy shifts in real time.' },
      { title: 'AI SEO Recommendations', description: 'On-page optimization suggestions, internal linking recommendations, and technical SEO issue detection.' },
      { title: 'Backlink Analysis', description: 'Analyze your backlink profile, identify toxic links, and find link-building opportunities automatically.' },
      { title: 'SERP Monitoring', description: 'Track rankings for your keywords across locations, devices, and search engines with daily updates.' },
    ],
    useCases: [
      'Content marketing teams scaling SEO-driven growth',
      'Agencies managing SEO for multiple clients',
      'SaaS products building organic acquisition channels',
      'Teams that want AI to do the keyword and content research',
    ],
    ctaText: 'Grow organically',
  },
  fuzequality: {
    slug: 'fuzequality',
    icon: CheckCircle2,
    name: 'FuzeQuality',
    tagline: 'Evidence-driven quality engineering',
    heroDescription: "FuzeQuality builds an evidence graph across your test suite, API contracts, and requirements — so you know exactly what's covered, what changed, and what broke.",
    gradient: 'from-lime-500 to-green-500',
    features: [
      { title: 'Cross-repo Test Coverage', description: 'Aggregate test coverage across every repo and service into a unified view with trend tracking over time.' },
      { title: 'OpenAPI Contract Validation', description: "Validate every API response against its OpenAPI spec automatically in CI — catch contract drift before it reaches production." },
      { title: 'Requirement Traceability', description: "Link tests to requirements and user stories so you know which features are covered and which aren't." },
      { title: 'Automated Quality Gates', description: 'Configure pass/fail thresholds on coverage, contract violations, and test reliability — block deploys that regress quality.' },
      { title: 'Evidence Graph', description: 'Visual graph of test to feature to requirement relationships for audit, compliance, and release confidence.' },
      { title: 'CI/CD Integration', description: 'Native integrations with GitHub Actions, GitLab CI, Jenkins, and every major CI platform.' },
    ],
    useCases: [
      'Engineering teams that need to prove test coverage to auditors',
      'Platforms validating microservice API contracts automatically',
      'QA teams linking test results back to product requirements',
      'Organizations releasing with confidence at speed',
    ],
    ctaText: 'Ship with confidence',
  },
  fuzebi: {
    slug: 'fuzebi',
    icon: BarChart3,
    name: 'FuzeBI',
    tagline: 'Turn your data into decisions',
    heroDescription: 'FuzeBI delivers real-time dashboards, custom reports, data connectors, and embeddable analytics — built for the speed and flexibility modern businesses demand.',
    gradient: 'from-indigo-500 to-blue-600',
    features: [
      { title: 'Real-time Dashboards', description: 'Build pixel-perfect dashboards with live data, auto-refresh, and drill-down on any metric.' },
      { title: 'Custom Report Builder', description: 'Drag-and-drop report builder with filters, grouping, calculations, and scheduled delivery.' },
      { title: 'Data Connectors', description: 'Connect to PostgreSQL, MySQL, BigQuery, Snowflake, Redshift, REST APIs, and more with no-code setup.' },
      { title: 'Embedded Analytics', description: 'Embed dashboards and charts into your own product with iframe, JS SDK, or React components.' },
      { title: 'Scheduled Exports', description: 'Automatically deliver reports to email, Slack, or S3 on any schedule — daily, weekly, or triggered.' },
      { title: 'Role-based Views', description: 'Define which metrics each user or organization sees with row-level security and tenant-aware filtering.' },
    ],
    useCases: [
      'SaaS products embedding analytics for their own customers',
      'Operations teams monitoring business KPIs in real time',
      'Finance teams building automated financial reporting',
      'Data teams replacing BI tool sprawl with one platform',
    ],
    ctaText: 'Unlock your data',
  },
  fuzex: {
    slug: 'fuzex',
    icon: Palette,
    name: 'FuzeX',
    tagline: 'Where design meets engineering',
    heroDescription: 'FuzeX bridges design and code — frame-based UX review, design-to-code pipelines, and automated QA flows that keep designers and engineers on the same page.',
    gradient: 'from-fuchsia-500 to-pink-600',
    features: [
      { title: 'Design-to-code Pipelines', description: 'Extract design tokens, component specs, and layout constraints directly from design frames into code.' },
      { title: 'Frame-based UX Review', description: 'Review and approve UI flows frame by frame with per-screen comments, approvals, and version diff.' },
      { title: 'Automated QA Flows', description: 'Run Playwright-based visual regression tests against approved frames — catch drift before it ships.' },
      { title: 'Component Library Sync', description: 'Keep your design system and code component library in sync with automated change detection.' },
      { title: 'Approval Workflows', description: 'Structured review cycles with designer, engineer, and product owner sign-off at each milestone.' },
      { title: 'Version History', description: 'Full version history for every frame, component, and design token with diff and rollback.' },
    ],
    useCases: [
      'Product teams closing the design-to-production feedback loop',
      'Design systems teams keeping tokens and components in sync',
      'QA engineers automating visual regression testing',
      'Organizations that need a signed-off design before code ships',
    ],
    ctaText: 'Bridge design and code',
  },
  fuzehub: {
    slug: 'fuzehub',
    icon: Monitor,
    name: 'FuzeHub',
    tagline: 'One view for your entire operation',
    heroDescription: 'FuzeHub is the unified operations hub — real-time monitoring, deployment dashboards, and team activity feeds across every Fuze product and your own services.',
    gradient: 'from-secondary-600 to-secondary-800',
    features: [
      { title: 'Real-time Monitoring', description: 'Live health metrics, error rates, and performance data across all your services and Fuze products.' },
      { title: 'Deployment Dashboards', description: 'Track active deployments, rollbacks, and release history across environments in a single view.' },
      { title: 'Team Activity Feeds', description: 'See what every team member is deploying, merging, and reviewing — with context and impact.' },
      { title: 'Integrated Alerting', description: 'Route alerts from any Fuze product or custom source to Slack, PagerDuty, email, or in-app.' },
      { title: 'Multi-product View', description: 'One dashboard for FuzeAgent runs, FuzeSocial publish jobs, FuzeKeys rotations, and your custom services.' },
      { title: 'Incident Management', description: 'Declare, coordinate, and post-mortem incidents with timeline reconstruction from activity feeds.' },
    ],
    useCases: [
      'Platform teams needing visibility across a fleet of Fuze products',
      'On-call engineers responding to incidents with full context',
      'Engineering managers tracking team velocity and deployment health',
      'Operations teams managing multi-service, multi-environment systems',
    ],
    ctaText: 'Get full visibility',
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
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Link
              to="/products"
              className="inline-flex items-center gap-1 text-white/70 hover:text-white text-sm mb-8 transition-colors"
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
                <p className="text-white/70 text-lg mt-1">{product.tagline}</p>
              </div>
            </div>

            <p className="text-white/85 text-lg leading-relaxed max-w-2xl mb-8">
              {product.heroDescription}
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <a
                href="https://app.fuzefront.com/auth/register"
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
                  <p className="text-sm text-gray-500 leading-relaxed">{feature.description}</p>
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
          <p className="text-gray-500 mb-8">
            Try free for 14 days. No credit card required.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <a
              href="https://app.fuzefront.com/auth/register"
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
