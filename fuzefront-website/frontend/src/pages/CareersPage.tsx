import React from 'react'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import { Mail, MapPin, Clock, Code2, Server, TrendingUp, Heart, Zap, Globe } from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

interface Position {
  code: string
  title: string
  department: string
  location: string
  type: string
  icon: React.ElementType
  description: string
  responsibilities: string[]
  qualifications: string[]
}

const positions: Position[] = [
  {
    code: 'ENG-101',
    title: 'Senior Full-Stack Engineer',
    department: 'Engineering',
    location: 'Remote',
    type: 'Full-time',
    icon: Code2,
    description:
      'Build product features across the FuzeOne family — React/TypeScript on the front end, Node.js services on the back end — working directly on our Module Federation host shell and the products built on it.',
    responsibilities: [
      'Ship end-to-end features across frontend and backend services',
      'Work within our Module Federation micro-frontend architecture',
      'Write tests, review code, and help maintain platform quality bars',
      'Collaborate with design and product on new capabilities',
    ],
    qualifications: [
      '4+ years building production React/TypeScript and Node.js applications',
      'Experience with Postgres and REST/event-driven APIs',
      'Comfortable working across the stack in a fast-moving team',
    ],
  },
  {
    code: 'ENG-102',
    title: 'Platform / DevOps Engineer',
    department: 'Engineering',
    location: 'Remote',
    type: 'Full-time',
    icon: Server,
    description:
      "Own the Kubernetes/Helm deployment pipeline that ships every FuzeOne product to production, and help scale our CI/CD, observability, and infrastructure-as-code practices.",
    responsibilities: [
      'Maintain and improve Helm charts, Argo CD GitOps pipelines, and CI workflows',
      'Own cluster reliability, monitoring, and incident response',
      'Harden deployment security and secrets management',
      'Partner with engineering teams on infrastructure needs',
    ],
    qualifications: [
      'Hands-on experience with Kubernetes, Helm, and GitOps workflows',
      'Familiarity with CI/CD pipelines (GitHub Actions or similar)',
      'Strong troubleshooting skills across networking, containers, and cloud infra',
    ],
  },
  {
    code: 'SALES-201',
    title: 'Enterprise Account Executive',
    department: 'Sales',
    location: 'Remote / Hybrid',
    type: 'Full-time',
    icon: TrendingUp,
    description:
      'Own the full sales cycle for mid-market and enterprise prospects — from qualifying inbound interest through closing multi-product FuzeOne deployments.',
    responsibilities: [
      'Manage a pipeline of enterprise and mid-market opportunities end-to-end',
      'Run product demos and tailor proposals to customer use cases',
      'Partner with customer success on renewals and expansion',
      'Represent customer feedback back to product and engineering',
    ],
    qualifications: [
      '3+ years of closing experience in B2B SaaS sales',
      'Comfortable selling technical platforms to engineering and IT buyers',
      'Track record of hitting or exceeding quota',
    ],
  },
]

const perks = [
  { icon: Globe, text: 'Fully remote, work from anywhere' },
  { icon: Heart, text: 'Health, dental, and vision coverage' },
  { icon: Zap, text: 'Equity in an early-stage, fast-growing company' },
  { icon: Clock, text: 'Flexible hours, unlimited PTO' },
]

export const CareersPage: React.FC = () => {
  const [heroRef, heroInView] = useInView({ triggerOnce: true, threshold: 0.1 })
  const { trackEvent } = useAnalytics()

  return (
    <div>
      {/* Hero */}
      <section
        ref={heroRef}
        className="relative pt-32 pb-20 bg-gradient-to-br from-secondary-900 via-secondary-800 to-primary-900 overflow-hidden"
      >
        {/* Separate overlay div: `hero-pattern` and the gradient classes both
            set `background-image`, so combining them on one element drops the
            gradient entirely instead of layering. */}
        <div className="absolute inset-0 hero-pattern pointer-events-none" />
        <div className="absolute top-10 left-1/4 w-80 h-80 bg-primary-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl sm:text-5xl font-heading font-extrabold text-white mb-6">
              Join <span className="gradient-text">FuzeOne</span>
            </h1>
            <p className="text-lg sm:text-xl text-secondary-300 max-w-2xl mx-auto leading-relaxed">
              We're a small, remote-first team building the operating system for SaaS. Help us
              build it.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Perks */}
      <section className="py-16 bg-white border-b border-secondary-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {perks.map((perk) => {
              const Icon = perk.icon
              return (
                <div key={perk.text} className="text-center">
                  <div className="w-11 h-11 rounded-xl bg-primary-50 flex items-center justify-center mx-auto mb-3">
                    <Icon size={20} className="text-primary-700" />
                  </div>
                  <p className="text-sm text-gray-600 leading-snug">{perk.text}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Open positions */}
      <section className="py-24 bg-secondary-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-heading font-bold text-gray-900 mb-4">
              Open positions
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Don't see a fit? Email us anyway at{' '}
              <a href="mailto:hr@fuzefront.com" className="text-primary-700 hover:underline">
                hr@fuzefront.com
              </a>
              — we're always looking for great people.
            </p>
          </div>

          <div className="space-y-6">
            {positions.map((position, i) => {
              const Icon = position.icon
              return (
                <motion.div
                  key={position.code}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="bg-white rounded-2xl border border-gray-200 shadow-soft p-6 sm:p-8"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-5">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-accent-600 flex items-center justify-center flex-shrink-0">
                        <Icon size={20} className="text-white" />
                      </div>
                      <div>
                        <span className="inline-block text-xs font-mono font-semibold text-primary-700 bg-primary-50 rounded px-2 py-0.5 mb-1.5">
                          {position.code}
                        </span>
                        <h3 className="text-xl font-bold text-gray-900">{position.title}</h3>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-sm text-gray-600">
                          <span>{position.department}</span>
                          <span className="flex items-center gap-1">
                            <MapPin size={13} /> {position.location}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={13} /> {position.type}
                          </span>
                        </div>
                      </div>
                    </div>
                    <a
                      href={`mailto:hr@fuzefront.com?subject=Application: ${position.code} — ${position.title}`}
                      className="btn-primary text-sm py-2.5 px-5 flex items-center justify-center gap-2 whitespace-nowrap"
                      onClick={() => trackEvent('careers_apply_click', { position: position.code })}
                    >
                      <Mail size={15} /> Apply now
                    </a>
                  </div>

                  <p className="text-gray-600 text-sm leading-relaxed mb-5">{position.description}</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-2">
                        Responsibilities
                      </h4>
                      <ul className="space-y-1.5">
                        {position.responsibilities.map((r) => (
                          <li key={r} className="text-sm text-gray-600 flex items-start gap-2">
                            <span className="w-1 h-1 rounded-full bg-primary-400 mt-2 flex-shrink-0" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-2">
                        Qualifications
                      </h4>
                      <ul className="space-y-1.5">
                        {position.qualifications.map((q) => (
                          <li key={q} className="text-sm text-gray-600 flex items-start gap-2">
                            <span className="w-1 h-1 rounded-full bg-primary-400 mt-2 flex-shrink-0" />
                            {q}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-5 pt-5 border-t border-gray-100 text-sm text-gray-600">
                    To apply, send your resume to{' '}
                    <a href="mailto:hr@fuzefront.com" className="text-primary-700 hover:underline font-medium">
                      hr@fuzefront.com
                    </a>{' '}
                    referencing position code <span className="font-mono font-semibold text-gray-700">{position.code}</span>.
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
