import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import { ArrowRight, Target, Lightbulb, ShieldCheck, Users2, Rocket, Globe2 } from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

const values = [
  {
    icon: Target,
    title: 'Our Mission',
    description:
      "Developers should focus on what makes their product unique — not on rebuilding the same authentication, billing, and infrastructure components over and over again.",
  },
  {
    icon: Lightbulb,
    title: 'Our Story',
    description:
      'Founded by engineers tired of reinventing the wheel, FuzeOne emerged from the frustration of building the same SaaS foundations across multiple projects, one platform at a time.',
  },
  {
    icon: ShieldCheck,
    title: 'How We Build',
    description:
      'Enterprise-grade security and compliance are the default, not an add-on. Every product ships with Authentik SSO, Permit.io RBAC, and audit-ready infrastructure from day one.',
  },
]

const offerings = [
  { icon: Rocket, text: 'A complete SaaS platform with every essential component pre-built' },
  { icon: Globe2, text: 'Shared infrastructure that scales with your business, not against it' },
  { icon: Users2, text: 'Modern development tools and Module Federation architecture' },
  { icon: ShieldCheck, text: 'Enterprise-grade security, SSO, and compliance out of the box' },
]

const stats = [
  { metric: '10', label: 'Products, one platform' },
  { metric: '99.9%', label: 'Platform uptime SLA' },
  { metric: '24/7', label: 'Priority support' },
]

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
}

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
}

export const AboutPage: React.FC = () => {
  const [heroRef, heroInView] = useInView({ triggerOnce: true, threshold: 0.1 })
  const [valuesRef, valuesInView] = useInView({ triggerOnce: true, threshold: 0.1 })
  const [offerRef, offerInView] = useInView({ triggerOnce: true, threshold: 0.1 })
  const { trackEvent } = useAnalytics()

  return (
    <div>
      {/* Hero */}
      <section
        ref={heroRef}
        className="relative pt-32 pb-20 bg-gradient-to-br from-secondary-900 via-secondary-800 to-primary-900 hero-pattern overflow-hidden"
      >
        <div className="absolute top-10 left-1/4 w-80 h-80 bg-primary-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-accent-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl sm:text-5xl font-heading font-extrabold text-white mb-6">
              About <span className="gradient-text">FuzeOne</span>
            </h1>
            <p className="text-lg sm:text-xl text-secondary-300 max-w-2xl mx-auto leading-relaxed">
              We're building the operating system for SaaS — integrated platforms that eliminate
              the need to rebuild common infrastructure, so teams can ship faster.
            </p>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-14 grid grid-cols-3 gap-6 max-w-lg mx-auto"
          >
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-3xl font-bold text-white">{s.metric}</div>
                <div className="text-secondary-400 text-xs sm:text-sm mt-1">{s.label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Values */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            ref={valuesRef}
            variants={stagger}
            initial="hidden"
            animate={valuesInView ? 'visible' : 'hidden'}
            className="grid grid-cols-1 md:grid-cols-3 gap-8"
          >
            {values.map((value) => {
              const Icon = value.icon
              return (
                <motion.div key={value.title} variants={fadeUp} className="group">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-accent-600 flex items-center justify-center mb-5 shadow-medium group-hover:scale-110 transition-transform duration-300">
                    <Icon size={22} className="text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{value.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{value.description}</p>
                </motion.div>
              )
            })}
          </motion.div>
        </div>
      </section>

      {/* What we offer */}
      <section className="py-24 bg-secondary-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            ref={offerRef}
            initial={{ opacity: 0, y: 20 }}
            animate={offerInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl sm:text-4xl font-heading font-bold text-gray-900 mb-4">
              What we offer
            </h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              Everything a growing SaaS product needs, bundled into one platform.
            </p>
          </motion.div>

          <motion.div
            variants={stagger}
            initial="hidden"
            animate={offerInView ? 'visible' : 'hidden'}
            className="grid grid-cols-1 sm:grid-cols-2 gap-5"
          >
            {offerings.map((item) => {
              const Icon = item.icon
              return (
                <motion.div
                  key={item.text}
                  variants={fadeUp}
                  className="flex items-start gap-4 bg-white rounded-2xl border border-gray-100 p-5 shadow-soft"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                    <Icon size={18} className="text-primary-600" />
                  </div>
                  <p className="text-gray-700 text-sm leading-relaxed pt-1.5">{item.text}</p>
                </motion.div>
              )
            })}
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-white border-t border-secondary-100">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl sm:text-4xl font-heading font-bold text-gray-900 mb-4">
            Want to build with us?
          </h2>
          <p className="text-lg text-gray-500 mb-8">
            Join hundreds of builders who've replaced weeks of infrastructure work with one platform.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <a
              href="https://app.fuzefront.com/signup"
              className="btn-primary flex items-center justify-center gap-2 text-base"
              onClick={() => trackEvent('cta_click', { button: 'about_start', location: 'about_cta' })}
            >
              Start building for free <ArrowRight size={18} />
            </a>
            <Link
              to="/careers"
              className="btn-secondary flex items-center justify-center gap-2 text-base"
              onClick={() => trackEvent('cta_click', { button: 'about_careers', location: 'about_cta' })}
            >
              View open roles
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
