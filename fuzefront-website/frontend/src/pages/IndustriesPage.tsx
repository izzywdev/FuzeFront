import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import {
  DollarSign, Heart, ShoppingBag, Scale, GraduationCap,
  Cloud, Briefcase, Building, ArrowRight, CheckCircle2
} from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

interface Industry {
  id: string
  icon: React.ElementType
  name: string
  tagline: string
  description: string
  challenges: string[]
  products: string[]
  gradient: string
}

const industries: Industry[] = [
  {
    id: 'fintech',
    icon: DollarSign,
    name: 'FinTech & Financial Services',
    tagline: 'Compliance-first infrastructure for financial products',
    description: 'FuzeOne is built for the compliance and audit requirements that financial products demand — from PCI-DSS to SOC 2. Ship faster without cutting corners on security.',
    challenges: [
      'Strict compliance requirements (PCI-DSS, SOC 2, PSD2)',
      'PII protection and tokenization at every layer',
      'Multi-entity accounting across jurisdictions',
      'Audit trails for every action and transaction',
    ],
    products: ['FuzeKeys (PII tokenization)', 'FuzeFinance (multi-currency GL)', 'FuzeQuality (compliance evidence)'],
    gradient: 'from-green-500 to-emerald-600',
  },
  {
    id: 'healthtech',
    icon: Heart,
    name: 'HealthTech & Healthcare',
    tagline: 'HIPAA-ready architecture for healthcare products',
    description: 'Healthcare software demands data privacy, audit trails, and role-based access that goes beyond basic RBAC. FuzeOne provides the building blocks so your team can focus on clinical workflows.',
    challenges: [
      'HIPAA compliance and PHI protection',
      'Granular role-based access (physician vs patient vs admin)',
      'Audit trails for every data access',
      'Integration with EHR systems and medical APIs',
    ],
    products: ['FuzeKeys (PHI tokenization)', 'FuzeFront (RBAC)', 'FuzeQuality (compliance gates)'],
    gradient: 'from-red-500 to-rose-600',
  },
  {
    id: 'ecommerce',
    icon: ShoppingBag,
    name: 'E-commerce & Retail',
    tagline: 'Scale storefronts without scaling your ops burden',
    description: 'From catalog management to social commerce and financial reconciliation, FuzeOne gives e-commerce teams the automation and analytics to move fast at scale.',
    challenges: [
      'Multi-channel social selling and content scheduling',
      'Revenue analytics and financial reconciliation',
      'Scaling auth and billing across storefronts',
      'AI-powered marketing and SEO',
    ],
    products: ['FuzeSocial (multi-channel)', 'FuzeFinance (reconciliation)', 'FuzeMarket (SEO)', 'FuzeBI (analytics)'],
    gradient: 'from-orange-500 to-amber-600',
  },
  {
    id: 'legaltech',
    icon: Scale,
    name: 'Legal Tech',
    tagline: 'Secure, auditable infrastructure for legal products',
    description: 'Legal software must be airtight — privileged access controls, document integrity, and audit trails that stand up in court. FuzeOne ships with those requirements already met.',
    challenges: [
      'Privileged access controls for sensitive documents',
      'Immutable audit logs and evidence chains',
      'Client confidentiality and data segregation',
      'Billing and matter management',
    ],
    products: ['FuzeKeys (secrets & access)', 'FuzeQuality (evidence graph)', 'FuzeFinance (billing)'],
    gradient: 'from-indigo-500 to-blue-700',
  },
  {
    id: 'edtech',
    icon: GraduationCap,
    name: 'EdTech',
    tagline: 'Scalable, FERPA-ready learning platforms',
    description: 'Learning platforms serve millions of students with diverse needs. FuzeOne handles identity, analytics, and content workflows so EdTech teams can focus on pedagogy.',
    challenges: [
      'FERPA compliance and student data protection',
      'Multi-tenancy for district and school hierarchies',
      'Learning analytics and progress tracking',
      'AI-powered content generation and personalization',
    ],
    products: ['FuzeFront (multi-tenant)', 'FuzeBI (learning analytics)', 'FuzeAgent (AI tutoring)'],
    gradient: 'from-yellow-500 to-orange-500',
  },
  {
    id: 'saas',
    icon: Cloud,
    name: 'SaaS Platforms',
    tagline: 'The platform for building platforms',
    description: 'FuzeOne was born as a SaaS platform for SaaS builders. If you\'re shipping a multi-tenant product, the primitives you need are already built.',
    challenges: [
      'Multi-tenant auth and billing from day one',
      'Module Federation for extensible UIs',
      'Usage-based pricing and metering',
      'Customer-facing analytics and dashboards',
    ],
    products: ['FuzeFront (Module Federation)', 'FuzeFinance (usage billing)', 'FuzeBI (embedded analytics)'],
    gradient: 'from-blue-500 to-cyan-500',
  },
  {
    id: 'agencies',
    icon: Briefcase,
    name: 'Agencies & Consultancies',
    tagline: 'Deliver more value to every client',
    description: 'Agencies need to move fast across projects and clients. FuzeOne gives your team reusable infrastructure, social scheduling, and analytics that multiply output without multiplying headcount.',
    challenges: [
      'Managing multi-client social media presence',
      'Reusable auth and billing infrastructure per project',
      'Cross-client reporting and analytics',
      'AI-powered content and campaign creation',
    ],
    products: ['FuzeSocial (multi-client)', 'FuzeMarket (SEO & content)', 'FuzeBI (client reporting)'],
    gradient: 'from-violet-500 to-purple-600',
  },
  {
    id: 'enterprise',
    icon: Building,
    name: 'Enterprise IT',
    tagline: 'Enterprise-grade deployment for large organizations',
    description: 'Large organizations need on-premise options, SSO integration, and governance tooling that meet security requirements. FuzeOne Enterprise delivers all of this with dedicated support.',
    challenges: [
      'SSO integration with existing identity providers',
      'On-premise or private cloud deployment',
      'SOC 2 and ISO 27001 compliance',
      'Central credential and secrets management',
    ],
    products: ['FuzeFront (enterprise SSO)', 'FuzeKeys (secrets vault)', 'FuzeQuality (compliance)'],
    gradient: 'from-secondary-600 to-secondary-800',
  },
]

function IndustrySection({ industry }: { industry: Industry }) {
  const [ref, inView] = useInView({ triggerOnce: true, threshold: 0.1 })
  const Icon = industry.icon

  return (
    <motion.div
      ref={ref}
      id={industry.id}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5 }}
      className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-medium transition-shadow duration-300"
    >
      <div className={`h-1.5 bg-gradient-to-r ${industry.gradient}`} />
      <div className="p-8">
        <div className="flex items-start gap-4 mb-5">
          <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${industry.gradient} flex items-center justify-center flex-shrink-0 shadow-sm`}>
            <Icon size={22} className="text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">{industry.name}</h3>
            <p className="text-sm text-primary-600 font-medium">{industry.tagline}</p>
          </div>
        </div>

        <p className="text-gray-500 text-sm leading-relaxed mb-6">{industry.description}</p>

        <div className="mb-6">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Key challenges addressed</h4>
          <ul className="space-y-2">
            {industry.challenges.map((challenge) => (
              <li key={challenge} className="flex items-start gap-2 text-sm text-gray-600">
                <CheckCircle2 size={14} className="text-success-500 flex-shrink-0 mt-0.5" />
                {challenge}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Recommended products</h4>
          <div className="flex flex-wrap gap-2">
            {industry.products.map((product) => (
              <span key={product} className="px-3 py-1 bg-secondary-100 text-secondary-700 rounded-full text-xs font-medium">
                {product}
              </span>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export const IndustriesPage: React.FC = () => {
  const { trackEvent } = useAnalytics()

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-br from-secondary-900 to-secondary-800 pt-28 pb-20 relative overflow-hidden">
        <div className="absolute inset-0 hero-pattern opacity-20" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="text-4xl sm:text-5xl font-heading font-extrabold text-white mb-4">
              Built for every industry
            </h1>
            <p className="text-lg text-secondary-300 max-w-2xl mx-auto mb-8">
              FuzeOne adapts to the compliance, security, and operational requirements of your vertical — not the other way around.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {industries.map((industry) => (
                <a
                  key={industry.id}
                  href={`#${industry.id}`}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-full text-sm font-medium transition-all"
                  onClick={() => trackEvent('industry_nav_click', { industry: industry.id })}
                >
                  {industry.name.split(' ')[0]}
                </a>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Industries Grid */}
      <section className="py-20 bg-secondary-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {industries.map((industry) => (
              <IndustrySection key={industry.id} industry={industry} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-white border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-heading font-bold text-gray-900 mb-4">
            Don't see your industry?
          </h2>
          <p className="text-gray-500 mb-8">
            Every business has unique requirements. Talk to our team — we'll help you map FuzeOne to your specific needs.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link
              to="/contact"
              className="btn-primary flex items-center justify-center gap-2"
              onClick={() => trackEvent('cta_click', { button: 'industries_contact', location: 'industries_cta' })}
            >
              Talk to us <ArrowRight size={16} />
            </Link>
            <Link to="/products" className="btn-secondary">
              Explore products
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
