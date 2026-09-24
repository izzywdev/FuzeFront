import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import {
  Layers, Shield, Server, ClipboardList, Palette, Bot,
  Key, MessageSquare, CheckCircle2, Rocket, ArrowRight, ChevronRight
} from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

interface Product {
  slug: string
  icon: React.ElementType
  name: string
  tagline: string
  description: string
  features: string[]
  gradient: string
}

const allProducts: Product[] = [
  {
    slug: 'fuzefront',
    icon: Layers,
    name: 'FuzeFront',
    tagline: 'The portal for your software factory',
    description: 'The Module-Federation host shell and portal for the whole product family. Enterprise auth (Authentik/OAuth2), RBAC (Permit.io), billing, a plugin marketplace, and the FuzeSDLC governance framework built directly in.',
    features: ['Authentik SSO & OAuth2', 'Permit.io RBAC', 'Built-in FuzeSDLC governance', 'Runtime Module Federation', 'Plugin marketplace', 'Shared design system'],
    gradient: 'from-blue-500 to-cyan-500',
  },
  {
    slug: 'fuzesdlc',
    icon: Shield,
    name: 'FuzeSDLC',
    tagline: 'The governance layer behind every product',
    description: 'The agentic software-delivery-lifecycle standard the whole factory runs on — single-responsibility agents, contract-first fan-out, and gated, signed releases. Embedded directly into FuzeFront, not a separate app to log into.',
    features: ['Baseline + repo-overlay governance', 'Single-responsibility agent roster', 'Contract-first fan-out', 'Design-first & authz CI gates', 'Signed, auto-merged releases', 'Cross-repo delegation'],
    gradient: 'from-slate-600 to-slate-800',
  },
  {
    slug: 'fuzeinfra',
    icon: Server,
    name: 'FuzeInfra',
    tagline: 'The infrastructure layer everything runs on',
    description: 'The shared, containerized infrastructure platform for the whole family — data stores, event streaming, and observability deployed consistently to local, staging, and production via GitOps.',
    features: ['Postgres / Redis / Neo4j / Elasticsearch', 'Kafka & RabbitMQ event streaming', 'Prometheus / Grafana / Loki', 'Helm + ArgoCD GitOps deploys', 'Local/staging/prod parity', 'Shared DNS & networking'],
    gradient: 'from-cyan-600 to-blue-700',
  },
  {
    slug: 'fuzeplan',
    icon: ClipboardList,
    name: 'FuzePlan',
    tagline: 'Product management, wired into Jira',
    description: 'Turns product requirements into well-formed, tracked work — tickets, sprints, and status reports that stay in sync with Jira and Confluence, from backlog grooming to cross-repo delegation.',
    features: ['Jira & Confluence integration', 'Ticket lifecycle management', 'Sprint planning & backlog grooming', 'Status reporting', 'Ticket-quality enforcement', 'Cross-repo coordination'],
    gradient: 'from-amber-500 to-orange-600',
  },
  {
    slug: 'fuzex',
    icon: Palette,
    name: 'FuzeX',
    tagline: 'UX/UI design & flow approvals',
    description: 'Owns UX/UI design and flow approval for the whole factory. Every feature starts as navigable design frames, reviewed and approved per-flow before a single line of UI code ships.',
    features: ['Navigable HTML design frames', 'Per-flow approval/reject workflow', 'Design-to-code build inventory', 'Frame-first CI gate', 'Cross-product review site', 'Version history & diffing'],
    gradient: 'from-fuchsia-500 to-pink-600',
  },
  {
    slug: 'fuzeagent',
    icon: Bot,
    name: 'FuzeAgent',
    tagline: 'Agent orchestration',
    description: 'Orchestrates the fleet of specialized AI agents that build, test, and ship every product — contract-first fan-out, multi-agent pipelines, human-in-the-loop checkpoints, and full auditability.',
    features: ['Multi-agent pipelines', 'Contract-first fan-out', 'Human-in-the-loop approvals', 'Kafka event streaming', 'Cost & usage tracking', 'Full audit trail'],
    gradient: 'from-violet-500 to-purple-600',
  },
  {
    slug: 'fuzekeys',
    icon: Key,
    name: 'FuzeKeys',
    tagline: 'Identity management',
    description: 'The identity layer for the family — SSO via Authentik, OAuth2/OIDC/SAML federation, and fine-grained authorization, so identity and permissions carry seamlessly across every product.',
    features: ['Authentik-powered SSO', 'OAuth2 / OIDC / SAML / LDAP', 'Fine-grained authorization (Permit.io)', 'Multi-tenant identity & org context', 'Secrets vaulting', 'Full access audit trail'],
    gradient: 'from-orange-500 to-red-500',
  },
  {
    slug: 'fuzepicker',
    icon: MessageSquare,
    name: 'FuzePicker',
    tagline: 'Production UX analysis & discussion',
    description: 'Captures real production UX — session flows, friction points, drop-offs — and turns it into a shared space for the team to review and discuss what to fix next.',
    features: ['Production UX session analysis', 'Friction & drop-off detection', 'Shared review & discussion threads', 'Flow replay', 'Prioritized UX findings', 'Hand-off to FuzeX for redesign'],
    gradient: 'from-teal-500 to-emerald-600',
  },
  {
    slug: 'fuzequality',
    icon: CheckCircle2,
    name: 'FuzeQuality',
    tagline: 'Automated UI/UX test coverage',
    description: 'Runs the automated UI and UX test coverage across every product — Playwright-driven visual regression, accessibility and contrast checks, and console-clean runtime validation.',
    features: ['Playwright UI/UX regression suites', 'WCAG contrast & accessibility checks', 'Console-clean runtime validation', 'Mobile/responsive device tests', 'Cross-repo coverage tracking', 'CI quality gates'],
    gradient: 'from-lime-500 to-green-600',
  },
  {
    slug: 'fuzedeploy',
    icon: Rocket,
    name: 'FuzeDeploy',
    tagline: 'Multi-cloud CI/CD automation',
    description: 'Automates CI/CD for the whole factory — build, test, sign, and release pipelines that deploy the same way across AWS, GCP, Azure, and on-prem Kubernetes.',
    features: ['Multi-cloud CI/CD pipelines', 'GitOps deploys via Helm + ArgoCD', 'Signed, gated releases', 'Auto-merge on green CI', 'Environment parity', 'Rollback & release history'],
    gradient: 'from-indigo-500 to-purple-700',
  },
]

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
}

function ProductCard({ product }: { product: Product }) {
  const [ref, inView] = useInView({ triggerOnce: true, threshold: 0.1 })
  const { trackEvent } = useAnalytics()
  const Icon = product.icon

  return (
    <motion.div
      ref={ref}
      variants={fadeUp}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-medium hover:border-primary-100 transition-all duration-300 group"
    >
      <div className={`h-2 bg-gradient-to-r ${product.gradient}`} />
      <div className="p-8">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${product.gradient} flex items-center justify-center mb-5 shadow-sm group-hover:scale-105 transition-transform duration-300`}>
          <Icon size={22} className="text-white" />
        </div>
        <p className="text-xs font-semibold text-primary-700 uppercase tracking-wider mb-1">{product.tagline}</p>
        <h3 className="text-xl font-bold text-gray-900 mb-3">{product.name}</h3>
        <p className="text-gray-600 text-sm leading-relaxed mb-6">{product.description}</p>

        <ul className="space-y-2 mb-6">
          {product.features.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-sm text-gray-600">
              <CheckCircle2 size={14} className="text-success-500 flex-shrink-0" />
              {feature}
            </li>
          ))}
        </ul>

        <Link
          to={`/products/${product.slug}`}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700 group-hover:gap-3 transition-all"
          onClick={() => trackEvent('product_card_click', { product: product.slug, from: 'products_page' })}
        >
          Learn more <ChevronRight size={14} />
        </Link>
      </div>
    </motion.div>
  )
}

export const ProductsPage: React.FC = () => {
  const { trackEvent } = useAnalytics()

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-br from-secondary-900 to-secondary-800 pt-28 pb-20 relative overflow-hidden">
        <div className="absolute inset-0 hero-pattern opacity-20" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl sm:text-5xl font-heading font-extrabold text-white mb-4">
              The complete Fuze family
            </h1>
            <p className="text-lg text-secondary-300 max-w-2xl mx-auto mb-8">
              10 products that work standalone and compose seamlessly — the portal, governance, infra, planning, design, agents, identity, UX research, quality, and deployment your software factory needs.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <a
                href="https://app.fuzefront.com/signup"
                className="btn-primary flex items-center justify-center gap-2"
                onClick={() => trackEvent('cta_click', { button: 'products_start', location: 'products_hero' })}
              >
                Start free <ArrowRight size={16} />
              </a>
              <Link
                to="/pricing"
                className="btn-ghost flex items-center justify-center gap-2"
              >
                View pricing
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Products grid */}
      <section className="py-20 bg-secondary-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {allProducts.map((product) => (
              <ProductCard key={product.slug} product={product} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-white border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-heading font-bold text-gray-900 mb-4">
            Not sure where to start?
          </h2>
          <p className="text-gray-600 mb-8">
            Talk to our team. We'll map your use case to the right products and set you up with a custom trial.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link to="/contact" className="btn-primary">
              Talk to sales
            </Link>
            <Link to="/pricing" className="btn-secondary">
              Compare plans
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
