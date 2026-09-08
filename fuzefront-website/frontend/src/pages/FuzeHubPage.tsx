import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import {
  Monitor, Activity, Rocket, Users, Bell, LayoutDashboard,
  ArrowRight, CheckCircle2, Shield, Zap
} from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

const features = [
  {
    icon: Activity,
    title: 'Real-time monitoring',
    description: 'Live health metrics, error rates, latency percentiles, and performance data across all your services and Fuze products — updated every second.',
  },
  {
    icon: Rocket,
    title: 'Deployment dashboards',
    description: 'Track active deployments, rollback status, and release history across dev, staging, and prod. Know exactly what version is live where.',
  },
  {
    icon: Users,
    title: 'Team activity feeds',
    description: 'See who deployed what, when, and why. Correlate deployments with alerts and incidents automatically using the activity timeline.',
  },
  {
    icon: Bell,
    title: 'Integrated alerting',
    description: 'Route alerts from any Fuze product or custom source to Slack, PagerDuty, email, or in-app — with deduplication and escalation rules.',
  },
  {
    icon: LayoutDashboard,
    title: 'Multi-product view',
    description: 'One dashboard for FuzeAgent pipeline runs, FuzeSocial publish jobs, FuzeKeys rotations, FuzeFinance reconciliation — and your custom services.',
  },
  {
    icon: Shield,
    title: 'Incident management',
    description: 'Declare, coordinate, and post-mortem incidents. Timeline reconstruction from activity feeds surfaces root cause faster.',
  },
]

const useCases = [
  { title: 'On-call engineers', description: 'Full context in one view during an incident — no tab-switching across 5 dashboards.' },
  { title: 'Engineering managers', description: 'Deployment velocity, team activity, and service health in a weekly snapshot.' },
  { title: 'Platform teams', description: 'Visibility across every Fuze product and custom service your team operates.' },
  { title: 'Operations teams', description: 'Multi-environment, multi-service health at a glance with actionable alerts.' },
]

function FeatureCard({ feature }: { feature: typeof features[0] }) {
  const [ref, inView] = useInView({ triggerOnce: true, threshold: 0.1 })
  const Icon = feature.icon
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.45 }}
      className="flex gap-4"
    >
      <div className="w-11 h-11 rounded-xl bg-secondary-800 flex items-center justify-center flex-shrink-0">
        <Icon size={20} className="text-primary-400" />
      </div>
      <div>
        <h3 className="font-semibold text-white mb-1">{feature.title}</h3>
        <p className="text-secondary-400 text-sm leading-relaxed">{feature.description}</p>
      </div>
    </motion.div>
  )
}

export const FuzeHubPage: React.FC = () => {
  const { trackEvent } = useAnalytics()
  const [ctaRef, ctaInView] = useInView({ triggerOnce: true, threshold: 0.1 })

  return (
    <div>
      {/* Hero */}
      <section className="bg-secondary-900 pt-28 pb-24 relative overflow-hidden">
        <div className="absolute inset-0 hero-pattern opacity-10" />
        {/* Accent glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-primary-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary-500/15 border border-primary-500/25 text-primary-400 text-sm font-medium mb-8">
              <Monitor size={14} /> FuzeHub — Unified Operations Hub
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-heading font-extrabold text-white mb-6 leading-tight">
              One view for your<br />entire operation
            </h1>
            <p className="text-lg text-secondary-300 max-w-2xl mx-auto mb-10">
              Real-time monitoring, deployment dashboards, team activity feeds, and integrated alerting — across every Fuze product and your own services. No more tab-switching.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <a
                href="https://app.fuzefront.com/signup"
                className="btn-primary flex items-center justify-center gap-2 text-base"
                onClick={() => trackEvent('cta_click', { button: 'fuzehub_start', location: 'fuzehub_hero' })}
              >
                Get full visibility <ArrowRight size={16} />
              </a>
              <Link
                to="/contact"
                className="btn-ghost flex items-center justify-center gap-2 text-base"
              >
                Talk to sales
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Mock Dashboard Visual */}
      <section className="bg-secondary-950 py-12 border-y border-secondary-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="bg-secondary-800 rounded-2xl border border-secondary-700 overflow-hidden shadow-hard"
          >
            {/* Fake toolbar */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-secondary-700 bg-secondary-900">
              <div className="w-3 h-3 rounded-full bg-error-500" />
              <div className="w-3 h-3 rounded-full bg-warning-400" />
              <div className="w-3 h-3 rounded-full bg-success-500" />
              <span className="ml-4 text-secondary-500 text-xs">FuzeHub — Production</span>
              <div className="ml-auto flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-success-400 animate-pulse" />
                <span className="text-success-400 text-xs">All systems operational</span>
              </div>
            </div>
            {/* Fake dashboard content */}
            <div className="p-6 grid grid-cols-3 gap-4">
              {[
                { label: 'Services healthy', value: '24/24', color: 'text-success-400' },
                { label: 'Deployments today', value: '12', color: 'text-primary-400' },
                { label: 'Open incidents', value: '0', color: 'text-success-400' },
              ].map((stat) => (
                <div key={stat.label} className="bg-secondary-900 rounded-xl p-4 border border-secondary-700">
                  <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-secondary-500 text-xs mt-1">{stat.label}</div>
                </div>
              ))}
            </div>
            <div className="px-6 pb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {['FuzeAgent', 'FuzeSocial', 'FuzeFinance', 'FuzeKeys'].map((service) => (
                <div key={service} className="bg-secondary-900 rounded-xl p-4 border border-secondary-700 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-success-400" />
                    <span className="text-secondary-300 text-sm">{service}</span>
                  </div>
                  <span className="text-secondary-500 text-xs">99.9% uptime</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-secondary-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-heading font-bold text-white mb-12 text-center">
            Everything you need, nothing you don't
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {features.map((feature) => (
              <FeatureCard key={feature.title} feature={feature} />
            ))}
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className="py-16 bg-secondary-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-heading font-bold text-white mb-10 text-center">
            Who uses FuzeHub
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {useCases.map((useCase) => (
              <div key={useCase.title} className="bg-secondary-900 rounded-xl border border-secondary-700 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Zap size={16} className="text-primary-400" />
                  <h3 className="font-semibold text-white text-sm">{useCase.title}</h3>
                </div>
                <p className="text-secondary-400 text-sm leading-relaxed">{useCase.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section ref={ctaRef} className="py-20 bg-secondary-900 border-t border-secondary-800">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={ctaInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="max-w-2xl mx-auto px-4 text-center"
        >
          <CheckCircle2 size={40} className="text-primary-400 mx-auto mb-6" />
          <h2 className="text-3xl font-heading font-bold text-white mb-4">
            Ready for full operational visibility?
          </h2>
          <p className="text-secondary-400 mb-8">
            FuzeHub is included in Professional, Scale, and Enterprise plans. Start your 14-day trial.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <a
              href="https://app.fuzefront.com/signup"
              className="btn-primary flex items-center justify-center gap-2"
              onClick={() => trackEvent('cta_click', { button: 'fuzehub_final_cta', location: 'fuzehub_bottom' })}
            >
              Start free trial <ArrowRight size={16} />
            </a>
            <Link to="/pricing" className="btn-ghost">
              Compare plans
            </Link>
          </div>
        </motion.div>
      </section>
    </div>
  )
}
