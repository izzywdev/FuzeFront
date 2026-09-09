import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import {
  Layers, Bot, Globe, CreditCard, Key, TrendingUp,
  CheckCircle2, BarChart3, Palette, Monitor, ArrowRight, ChevronRight
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
    name: 'FuzeFront Platform',
    tagline: 'The Module-Federation host shell',
    description: 'Enterprise auth (Authentik/OAuth2), RBAC (Permit.io), built-in billing (Stripe), plugin system, AI assistant, and shared infra. The core platform everything else runs on.',
    features: ['Authentik SSO & OAuth2', 'Permit.io RBAC', 'Stripe billing & subscriptions', 'Runtime Module Federation', 'Plugin marketplace', 'AI chat assistant'],
    gradient: 'from-blue-500 to-cyan-500',
  },
  {
    slug: 'fuzeagent',
    icon: Bot,
    name: 'FuzeAgent',
    tagline: 'AI team orchestration',
    description: 'Autonomous agent workflows, multi-agent pipelines, human-in-the-loop approval, and Kafka event streaming.',
    features: ['Multi-agent pipelines', 'Human-in-the-loop approvals', 'Kafka event streaming', 'Custom agent templates', 'Audit trail', 'Cost tracking'],
    gradient: 'from-violet-500 to-purple-600',
  },
  {
    slug: 'fuzesocial',
    icon: Globe,
    name: 'FuzeSocial',
    tagline: 'Social media automation',
    description: 'Schedule and publish to Facebook, Instagram, TikTok, YouTube, Reddit, X, and WhatsApp from one dashboard. AI-generated content, analytics, cross-platform scheduling.',
    features: ['7+ social platforms', 'AI content generation', 'Cross-platform scheduling', 'Advanced analytics', 'Team collaboration', 'Content calendar'],
    gradient: 'from-pink-500 to-rose-500',
  },
  {
    slug: 'fuzefinance',
    icon: CreditCard,
    name: 'FuzeFinance',
    tagline: 'Enterprise finance & accounting',
    description: 'Invoices, general ledger, reporting, payouts. Multi-entity, multi-currency financial operations.',
    features: ['Invoice management', 'General ledger', 'Multi-entity support', 'Multi-currency', 'Financial reporting', 'Automated payouts'],
    gradient: 'from-green-500 to-emerald-600',
  },
  {
    slug: 'fuzekeys',
    icon: Key,
    name: 'FuzeKeys',
    tagline: 'AI-powered credential management',
    description: 'Secrets vault, PII tokenization, API key rotation, audit trail — enterprise-grade credential management with AI anomaly detection.',
    features: ['Secrets vault', 'PII tokenization', 'Automatic key rotation', 'AI anomaly detection', 'Full audit trail', 'Team access controls'],
    gradient: 'from-orange-500 to-amber-500',
  },
  {
    slug: 'fuzemarket',
    icon: TrendingUp,
    name: 'FuzeMarket',
    tagline: 'Marketing & SEO intelligence',
    description: 'Keyword strategy, content pipeline, competitor tracking, and AI-powered SEO recommendations.',
    features: ['Keyword strategy engine', 'Content pipeline', 'Competitor tracking', 'AI SEO recommendations', 'Backlink analysis', 'SERP monitoring'],
    gradient: 'from-teal-500 to-cyan-500',
  },
  {
    slug: 'fuzequality',
    icon: CheckCircle2,
    name: 'FuzeQuality',
    tagline: 'Evidence graph & QA',
    description: 'Cross-repo test coverage, OpenAPI contract validation, requirement traceability, automated quality gates.',
    features: ['Cross-repo test coverage', 'OpenAPI contract validation', 'Requirement traceability', 'Automated quality gates', 'Evidence graph', 'CI/CD integration'],
    gradient: 'from-lime-500 to-green-500',
  },
  {
    slug: 'fuzebi',
    icon: BarChart3,
    name: 'FuzeBI',
    tagline: 'Business intelligence',
    description: 'Real-time dashboards, custom reports, data connectors, embedded analytics — turn your data into decisions.',
    features: ['Real-time dashboards', 'Custom report builder', 'Data connectors', 'Embedded analytics', 'Scheduled exports', 'Role-based views'],
    gradient: 'from-indigo-500 to-blue-600',
  },
  {
    slug: 'fuzex',
    icon: Palette,
    name: 'FuzeX',
    tagline: 'Design & workflow studio',
    description: 'Design-to-code pipelines, frame-based UX review, automated QA flows. Bridge design and engineering.',
    features: ['Design-to-code pipelines', 'Frame-based UX review', 'Automated QA flows', 'Component library sync', 'Approval workflows', 'Version history'],
    gradient: 'from-fuchsia-500 to-pink-600',
  },
  {
    slug: 'fuzehub',
    icon: Monitor,
    name: 'FuzeHub',
    tagline: 'Unified operations hub',
    description: 'Single pane of glass for monitoring, deployments, team activity across all Fuze products.',
    features: ['Real-time monitoring', 'Deployment dashboards', 'Team activity feeds', 'Integrated alerting', 'Multi-product view', 'Incident management'],
    gradient: 'from-secondary-600 to-secondary-800',
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
              10 products that work standalone and compose seamlessly. Auth, AI, social, finance, security, analytics — everything your business needs.
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
