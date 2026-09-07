import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import {
  ArrowRight,
  Shield,
  Zap,
  CreditCard,
  Bot,
  BarChart3,
  Layers,
  Key,
  TrendingUp,
  CheckCircle2,
  Users,
  Globe,
  Cpu,
  ChevronRight,
} from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'
import { useNewsletter } from '../hooks/useApi'

const IS_DEVELOPMENT = import.meta.env.DEV || import.meta.env.NODE_ENV === 'development'

const products = [
  {
    slug: 'fuzefront',
    icon: Layers,
    name: 'FuzeFront Platform',
    tagline: 'Module Federation host shell',
    description: 'Enterprise auth, RBAC, billing, plugin system, and AI assistant. The core platform everything runs on.',
    color: 'from-blue-500 to-cyan-500',
    bg: 'bg-blue-50',
  },
  {
    slug: 'fuzeagent',
    icon: Bot,
    name: 'FuzeAgent',
    tagline: 'AI team orchestration',
    description: 'Autonomous agent workflows, multi-agent pipelines, and human-in-the-loop approval.',
    color: 'from-violet-500 to-purple-600',
    bg: 'bg-violet-50',
  },
  {
    slug: 'fuzesocial',
    icon: Globe,
    name: 'FuzeSocial',
    tagline: 'Social media automation',
    description: 'Schedule and publish to Facebook, Instagram, TikTok, YouTube, X, and more from one dashboard.',
    color: 'from-pink-500 to-rose-500',
    bg: 'bg-pink-50',
  },
  {
    slug: 'fuzefinance',
    icon: CreditCard,
    name: 'FuzeFinance',
    tagline: 'Enterprise finance & accounting',
    description: 'Invoices, GL, payouts, multi-entity, multi-currency — full financial operations.',
    color: 'from-green-500 to-emerald-600',
    bg: 'bg-green-50',
  },
  {
    slug: 'fuzekeys',
    icon: Key,
    name: 'FuzeKeys',
    tagline: 'AI-powered credential management',
    description: 'Secrets vault, PII tokenization, API key rotation, and complete audit trail.',
    color: 'from-orange-500 to-amber-500',
    bg: 'bg-orange-50',
  },
  {
    slug: 'fuzebi',
    icon: BarChart3,
    name: 'FuzeBI',
    tagline: 'Business intelligence',
    description: 'Real-time dashboards, custom reports, data connectors, and embedded analytics.',
    color: 'from-indigo-500 to-blue-600',
    bg: 'bg-indigo-50',
  },
]

const valueProps = [
  {
    icon: Zap,
    title: 'Launch 10x faster',
    description: 'Auth, billing, AI, and infra are pre-built. Ship features on day one, not month three.',
    gradient: 'from-yellow-400 to-orange-500',
  },
  {
    icon: Shield,
    title: 'Enterprise-grade security',
    description: 'Authentik SSO, Permit.io RBAC, secrets management, and SOC 2 ready out of the box.',
    gradient: 'from-blue-500 to-indigo-600',
  },
  {
    icon: Layers,
    title: 'Module Federation architecture',
    description: 'Micro-frontend host shell. Load any remote app at runtime with shared React singletons.',
    gradient: 'from-purple-500 to-pink-500',
  },
  {
    icon: Cpu,
    title: 'AI-native from day one',
    description: 'FuzeAgent, AI chat, and intelligent automation woven through every product.',
    gradient: 'from-green-400 to-teal-500',
  },
]

const industries = [
  'FinTech & Finance', 'HealthTech', 'E-commerce', 'Legal Tech',
  'EdTech', 'SaaS Platforms', 'Agencies', 'Enterprise IT',
]

const socialProof = [
  { metric: '10x', label: 'Faster time to market' },
  { metric: '99.9%', label: 'Platform uptime SLA' },
  { metric: '50+', label: 'Enterprise integrations' },
  { metric: '24/7', label: 'Priority support' },
]

const fadeUpVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
}

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
}

function SectionWrapper({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const [ref, inView] = useInView({ triggerOnce: true, threshold: 0.1 })
  return (
    <motion.div
      ref={ref}
      variants={staggerContainer}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export const HomePage: React.FC = () => {
  const { trackEvent } = useAnalytics()
  const { subscribe, loading: newsletterLoading, success: newsletterSuccess, error: newsletterError } = useNewsletter()
  const [email, setEmail] = useState('')

  const handleNewsletterSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    try {
      await subscribe({ email: email.trim() })
      setEmail('')
      trackEvent('newsletter_subscribe', { location: 'homepage' })
    } catch (err) {
      if (IS_DEVELOPMENT) console.error('Newsletter error:', err)
    }
  }

  return (
    <div className="overflow-x-hidden">
      {/* ── Hero ── */}
      <section className="relative min-h-screen flex items-center bg-gradient-to-br from-secondary-900 via-secondary-800 to-primary-900 hero-pattern overflow-hidden">
        {/* Background orbs */}
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-primary-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-20 right-1/4 w-80 h-80 bg-accent-600/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20">
          <div className="text-center max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary-500/20 border border-primary-500/30 text-primary-300 text-sm font-medium mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
                Now in general availability — 10 products, one platform
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-5xl sm:text-6xl lg:text-7xl font-heading font-extrabold text-white leading-tight mb-6"
            >
              The operating system
              <span className="block gradient-text mt-2">for your SaaS</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.25 }}
              className="text-lg sm:text-xl text-secondary-300 max-w-2xl mx-auto mb-10 leading-relaxed"
            >
              Auth, billing, AI, and Module Federation architecture — pre-built and production-ready.
              Stop re-inventing infrastructure. Start shipping products.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <a
                href="https://app.fuzefront.com/auth/register"
                className="btn-primary text-base px-8 py-4 flex items-center gap-2"
                onClick={() => trackEvent('cta_click', { button: 'hero_start_building', location: 'hero' })}
              >
                Start building for free <ArrowRight size={18} />
              </a>
              <Link
                to="/contact"
                className="btn-ghost text-base px-8 py-4"
                onClick={() => trackEvent('cta_click', { button: 'hero_talk_sales', location: 'hero' })}
              >
                Talk to sales
              </Link>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="mt-6 text-secondary-500 text-sm"
            >
              No credit card required &middot; 14-day free trial &middot; Cancel anytime
            </motion.p>
          </div>

          {/* Metrics strip */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto"
          >
            {socialProof.map((item) => (
              <div key={item.label} className="text-center">
                <div className="text-3xl font-bold text-white">{item.metric}</div>
                <div className="text-secondary-400 text-sm mt-1">{item.label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Value Props ── */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionWrapper>
            <motion.div variants={fadeUpVariants} className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-heading font-bold text-gray-900 mb-4">
                Everything your SaaS needs, none of the overhead
              </h2>
              <p className="text-lg text-gray-500 max-w-2xl mx-auto">
                FuzeOne bundles the primitives that every product team reinvents — so yours doesn't have to.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {valueProps.map((prop) => {
                const Icon = prop.icon
                return (
                  <motion.div key={prop.title} variants={fadeUpVariants} className="group">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${prop.gradient} flex items-center justify-center mb-5 shadow-medium group-hover:scale-110 transition-transform duration-300`}>
                      <Icon size={22} className="text-white" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">{prop.title}</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">{prop.description}</p>
                  </motion.div>
                )
              })}
            </div>
          </SectionWrapper>
        </div>
      </section>

      {/* ── Products Grid ── */}
      <section className="py-24 bg-secondary-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionWrapper>
            <motion.div variants={fadeUpVariants} className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-heading font-bold text-gray-900 mb-4">
                10 products. One platform. Zero lock-in.
              </h2>
              <p className="text-lg text-gray-500 max-w-2xl mx-auto">
                Each Fuze product works standalone and integrates seamlessly with the others.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map((product) => {
                const Icon = product.icon
                return (
                  <motion.div key={product.slug} variants={fadeUpVariants}>
                    <Link
                      to={`/products/${product.slug}`}
                      className="block group h-full bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-medium hover:border-primary-100 transition-all duration-300"
                      onClick={() => trackEvent('product_card_click', { product: product.slug })}
                    >
                      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${product.color} flex items-center justify-center mb-4 shadow-sm group-hover:scale-110 transition-transform duration-300`}>
                        <Icon size={20} className="text-white" />
                      </div>
                      <p className="text-xs font-medium text-primary-500 uppercase tracking-wider mb-1">{product.tagline}</p>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2 group-hover:text-primary-600 transition-colors">{product.name}</h3>
                      <p className="text-sm text-gray-500 leading-relaxed mb-4">{product.description}</p>
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 group-hover:gap-2 transition-all">
                        Learn more <ChevronRight size={14} />
                      </span>
                    </Link>
                  </motion.div>
                )
              })}
            </div>

            <motion.div variants={fadeUpVariants} className="text-center mt-10">
              <Link
                to="/products"
                className="btn-secondary inline-flex items-center gap-2"
                onClick={() => trackEvent('cta_click', { button: 'view_all_products', location: 'products_section' })}
              >
                View all 10 products <ArrowRight size={16} />
              </Link>
            </motion.div>
          </SectionWrapper>
        </div>
      </section>

      {/* ── Industries ── */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionWrapper>
            <motion.div variants={fadeUpVariants} className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-heading font-bold text-gray-900 mb-4">
                Built for every vertical
              </h2>
              <p className="text-lg text-gray-500 max-w-xl mx-auto">
                From FinTech compliance to HealthTech HIPAA requirements — FuzeOne adapts to your industry's rules.
              </p>
            </motion.div>

            <motion.div variants={fadeUpVariants} className="flex flex-wrap justify-center gap-3">
              {industries.map((industry) => (
                <Link
                  key={industry}
                  to="/industries"
                  className="px-5 py-2.5 bg-secondary-50 hover:bg-primary-50 text-gray-700 hover:text-primary-700 border border-secondary-200 hover:border-primary-200 rounded-full text-sm font-medium transition-all duration-200"
                  onClick={() => trackEvent('industry_tag_click', { industry })}
                >
                  {industry}
                </Link>
              ))}
            </motion.div>

            <motion.div variants={fadeUpVariants} className="text-center mt-8">
              <Link
                to="/industries"
                className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 font-medium text-sm"
              >
                See industry solutions <ChevronRight size={14} />
              </Link>
            </motion.div>
          </SectionWrapper>
        </div>
      </section>

      {/* ── Pricing Teaser ── */}
      <section className="py-24 bg-gradient-to-br from-primary-900 via-secondary-900 to-accent-900 relative overflow-hidden">
        <div className="absolute inset-0 hero-pattern opacity-30" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <SectionWrapper>
            <motion.div variants={fadeUpVariants}>
              <h2 className="text-3xl sm:text-4xl font-heading font-bold text-white mb-4">
                Simple pricing for every stage
              </h2>
              <p className="text-lg text-secondary-300 mb-8 max-w-xl mx-auto">
                Start free. Scale confidently. Enterprise options for unlimited teams and on-premise deployment.
              </p>
              <div className="flex flex-wrap justify-center gap-6 mb-10">
                {[
                  { name: 'Starter', price: '$29/mo', note: 'Up to 5 members' },
                  { name: 'Professional', price: '$99/mo', note: 'Up to 25 members', featured: true },
                  { name: 'Scale', price: '$299/mo', note: 'Up to 100 members' },
                  { name: 'Enterprise', price: 'Custom', note: 'Unlimited everything' },
                ].map((plan) => (
                  <div
                    key={plan.name}
                    className={`px-6 py-4 rounded-xl border text-center min-w-32 ${
                      plan.featured
                        ? 'bg-primary-600 border-primary-400 text-white'
                        : 'bg-white/10 border-white/20 text-white'
                    }`}
                  >
                    <div className="font-semibold text-sm mb-1">{plan.name}</div>
                    <div className="text-xl font-bold mb-1">{plan.price}</div>
                    <div className="text-xs opacity-75">{plan.note}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <Link
                  to="/pricing"
                  className="btn-primary flex items-center justify-center gap-2"
                  onClick={() => trackEvent('cta_click', { button: 'view_pricing', location: 'pricing_teaser' })}
                >
                  See all plans <ArrowRight size={16} />
                </Link>
                <Link
                  to="/contact"
                  className="btn-ghost flex items-center justify-center gap-2"
                  onClick={() => trackEvent('cta_click', { button: 'talk_sales', location: 'pricing_teaser' })}
                >
                  Talk to sales
                </Link>
              </div>
            </motion.div>
          </SectionWrapper>
        </div>
      </section>

      {/* ── Newsletter ── */}
      <section className="py-20 bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
          <SectionWrapper>
            <motion.div variants={fadeUpVariants}>
              <Users size={32} className="text-primary-500 mx-auto mb-4" />
              <h2 className="text-2xl sm:text-3xl font-heading font-bold text-gray-900 mb-3">
                Stay in the loop
              </h2>
              <p className="text-gray-500 mb-8">
                Product updates, engineering deep-dives, and launch announcements. No spam.
              </p>

              {newsletterSuccess ? (
                <div className="flex items-center justify-center gap-2 text-success-600 font-medium">
                  <CheckCircle2 size={20} />
                  You're on the list. Thanks!
                </div>
              ) : (
                <form onSubmit={handleNewsletterSubmit} className="flex gap-3 max-w-md mx-auto">
                  <input
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="flex-1 px-4 py-3 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                  />
                  <button
                    type="submit"
                    disabled={newsletterLoading}
                    className="btn-primary py-3 px-5 text-sm whitespace-nowrap"
                  >
                    {newsletterLoading ? 'Joining...' : 'Subscribe'}
                  </button>
                </form>
              )}
              {newsletterError && (
                <p className="text-error-600 text-sm mt-3">{newsletterError}</p>
              )}
            </motion.div>
          </SectionWrapper>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-20 bg-secondary-50 border-t border-secondary-100">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <SectionWrapper>
            <motion.div variants={fadeUpVariants}>
              <h2 className="text-3xl sm:text-4xl font-heading font-bold text-gray-900 mb-4">
                Ready to build on FuzeOne?
              </h2>
              <p className="text-lg text-gray-500 mb-8">
                Join hundreds of builders who've replaced weeks of infrastructure work with one platform.
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <a
                  href="https://app.fuzefront.com/auth/register"
                  className="btn-primary flex items-center justify-center gap-2 text-base"
                  onClick={() => trackEvent('cta_click', { button: 'footer_start', location: 'final_cta' })}
                >
                  Start building for free <ArrowRight size={18} />
                </a>
                <Link
                  to="/contact"
                  className="btn-secondary flex items-center justify-center gap-2 text-base"
                  onClick={() => trackEvent('cta_click', { button: 'footer_sales', location: 'final_cta' })}
                >
                  Talk to sales
                </Link>
              </div>
              <p className="mt-6 text-sm text-gray-400">
                No credit card required &middot; Free for 14 days &middot; Scales as you grow
              </p>
            </motion.div>
          </SectionWrapper>
        </div>
      </section>
    </div>
  )
}
