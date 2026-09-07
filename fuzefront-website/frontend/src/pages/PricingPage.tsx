import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import { Check, X, ArrowRight, Zap, Building2, Rocket, Crown } from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

interface Plan {
  name: string
  icon: React.ElementType
  monthlyPrice: number | null
  yearlyPrice: number | null
  description: string
  members: string
  popular: boolean
  ctaText: string
  ctaHref: string
  features: string[]
  notIncluded?: string[]
}

const plans: Plan[] = [
  {
    name: 'Starter',
    icon: Rocket,
    monthlyPrice: 29,
    yearlyPrice: 290,
    description: 'Perfect for small teams getting started',
    members: 'Up to 5 members',
    popular: false,
    ctaText: 'Start free trial',
    ctaHref: 'https://app.fuzefront.com/auth/register?plan=starter',
    features: [
      'Up to 5 team members',
      'Core auth & billing',
      'Basic analytics',
      '99.9% uptime SLA',
      'Community support',
      'FuzeFront Platform access',
      '5 GB storage',
    ],
    notIncluded: ['SSO / SAML', 'Advanced analytics', 'Custom integrations', 'API access'],
  },
  {
    name: 'Professional',
    icon: Zap,
    monthlyPrice: 99,
    yearlyPrice: 990,
    description: 'For growing teams that need more power',
    members: 'Up to 25 members',
    popular: true,
    ctaText: 'Start free trial',
    ctaHref: 'https://app.fuzefront.com/auth/register?plan=professional',
    features: [
      'Up to 25 team members',
      'Advanced auth & SSO',
      'Priority support',
      'Advanced analytics',
      'Custom integrations',
      'Full API access',
      'Module Federation hosting',
      'All core products included',
      '50 GB storage',
      '99.9% uptime SLA',
    ],
  },
  {
    name: 'Scale',
    icon: Building2,
    monthlyPrice: 299,
    yearlyPrice: 2990,
    description: 'For scaling teams and growing businesses',
    members: 'Up to 100 members',
    popular: false,
    ctaText: 'Start free trial',
    ctaHref: 'https://app.fuzefront.com/auth/register?plan=scale',
    features: [
      'Up to 100 team members',
      'Unlimited API calls',
      'Dedicated support',
      'Custom domain',
      'All 10 products included',
      'Advanced security controls',
      'Custom integrations',
      'Audit logs',
      '500 GB storage',
      'SSO/SAML',
      '99.99% uptime SLA',
    ],
  },
  {
    name: 'Enterprise',
    icon: Crown,
    monthlyPrice: null,
    yearlyPrice: null,
    description: 'Unlimited scale, dedicated partnership',
    members: 'Unlimited members',
    popular: false,
    ctaText: 'Contact sales',
    ctaHref: '/contact?inquiry=enterprise',
    features: [
      'Unlimited team members',
      'On-premise deployment option',
      'Custom SLA guarantees',
      'Professional services',
      'Dedicated CSM',
      'Custom contracts',
      'HIPAA / SOC 2 assistance',
      'White-label options',
      'Unlimited storage',
      'All products + early access',
      'Priority engineering support',
    ],
  },
]

const featureComparison = [
  { feature: 'Team members', starter: '5', professional: '25', scale: '100', enterprise: 'Unlimited' },
  { feature: 'Core auth & billing', starter: true, professional: true, scale: true, enterprise: true },
  { feature: 'SSO / SAML', starter: false, professional: true, scale: true, enterprise: true },
  { feature: 'Advanced analytics', starter: false, professional: true, scale: true, enterprise: true },
  { feature: 'API access', starter: false, professional: true, scale: true, enterprise: true },
  { feature: 'Module Federation hosting', starter: false, professional: true, scale: true, enterprise: true },
  { feature: 'All 10 products', starter: false, professional: true, scale: true, enterprise: true },
  { feature: 'Custom integrations', starter: false, professional: true, scale: true, enterprise: true },
  { feature: 'Dedicated support', starter: false, professional: false, scale: true, enterprise: true },
  { feature: 'Custom domain', starter: false, professional: false, scale: true, enterprise: true },
  { feature: 'Audit logs', starter: false, professional: false, scale: true, enterprise: true },
  { feature: 'On-premise deployment', starter: false, professional: false, scale: false, enterprise: true },
  { feature: 'Dedicated CSM', starter: false, professional: false, scale: false, enterprise: true },
  { feature: 'Custom SLA', starter: false, professional: false, scale: false, enterprise: true },
  { feature: 'Uptime SLA', starter: '99.9%', professional: '99.9%', scale: '99.99%', enterprise: 'Custom' },
]

type FeatureValue = boolean | string

function FeatureCell({ value }: { value: FeatureValue }) {
  if (value === true) return <Check size={16} className="text-success-500 mx-auto" />
  if (value === false) return <X size={16} className="text-gray-300 mx-auto" />
  return <span className="text-sm text-gray-700">{value}</span>
}

export const PricingPage: React.FC = () => {
  const [yearly, setYearly] = useState(false)
  const { trackEvent } = useAnalytics()
  const [ref, inView] = useInView({ triggerOnce: true, threshold: 0.1 })

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-br from-secondary-900 to-secondary-800 pt-28 pb-16 relative overflow-hidden">
        <div className="absolute inset-0 hero-pattern opacity-20" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="text-4xl sm:text-5xl font-heading font-extrabold text-white mb-4">
              Simple, transparent pricing
            </h1>
            <p className="text-lg text-secondary-300 mb-8 max-w-xl mx-auto">
              Start free, scale without surprises. All plans include a 14-day free trial.
            </p>

            {/* Toggle */}
            <div className="inline-flex items-center gap-3 bg-secondary-800 border border-secondary-700 rounded-full p-1">
              <button
                onClick={() => { setYearly(false); trackEvent('pricing_toggle', { period: 'monthly' }) }}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${!yearly ? 'bg-white text-gray-900' : 'text-secondary-300 hover:text-white'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => { setYearly(true); trackEvent('pricing_toggle', { period: 'yearly' }) }}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${yearly ? 'bg-white text-gray-900' : 'text-secondary-300 hover:text-white'}`}
              >
                Yearly
                <span className="bg-success-500 text-white text-xs px-2 py-0.5 rounded-full">Save 17%</span>
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Plans */}
      <section className="py-16 bg-secondary-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {plans.map((plan, i) => {
              const Icon = plan.icon
              const price = yearly ? plan.yearlyPrice : plan.monthlyPrice
              const isEnterprise = plan.monthlyPrice === null

              return (
                <motion.div
                  key={plan.name}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1, duration: 0.45 }}
                  className={`relative rounded-2xl overflow-hidden ${
                    plan.popular
                      ? 'ring-2 ring-primary-500 shadow-hard'
                      : 'border border-gray-200 shadow-soft'
                  } bg-white`}
                >
                  {plan.popular && (
                    <div className="bg-primary-600 text-white text-xs font-semibold text-center py-1.5 tracking-wide uppercase">
                      Most popular
                    </div>
                  )}

                  <div className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-10 h-10 rounded-xl ${plan.popular ? 'bg-primary-100' : 'bg-secondary-100'} flex items-center justify-center`}>
                        <Icon size={18} className={plan.popular ? 'text-primary-600' : 'text-secondary-600'} />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900">{plan.name}</h3>
                        <p className="text-xs text-gray-500">{plan.members}</p>
                      </div>
                    </div>

                    <p className="text-sm text-gray-500 mb-5 leading-relaxed">{plan.description}</p>

                    <div className="mb-6">
                      {isEnterprise ? (
                        <div className="text-3xl font-extrabold text-gray-900">Custom</div>
                      ) : (
                        <>
                          <div className="flex items-end gap-1">
                            <span className="text-4xl font-extrabold text-gray-900">${price}</span>
                            <span className="text-gray-400 text-sm mb-1">/{yearly ? 'year' : 'mo'}</span>
                          </div>
                          {yearly && (
                            <p className="text-xs text-success-600 mt-1">
                              ${Math.round((plan.monthlyPrice ?? 0) * 12 - (plan.yearlyPrice ?? 0))} saved vs monthly
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    {isEnterprise ? (
                      <Link
                        to={plan.ctaHref}
                        className="block w-full text-center py-3 px-4 rounded-lg font-medium bg-secondary-900 text-white hover:bg-secondary-800 transition-colors mb-6 text-sm"
                        onClick={() => trackEvent('pricing_cta_click', { plan: plan.name })}
                      >
                        {plan.ctaText}
                      </Link>
                    ) : (
                      <a
                        href={plan.ctaHref}
                        className={`block w-full text-center py-3 px-4 rounded-lg font-medium transition-colors mb-6 text-sm ${
                          plan.popular
                            ? 'bg-primary-600 text-white hover:bg-primary-700'
                            : 'bg-secondary-100 text-secondary-800 hover:bg-secondary-200'
                        }`}
                        onClick={() => trackEvent('pricing_cta_click', { plan: plan.name })}
                      >
                        {plan.ctaText}
                      </a>
                    )}

                    <ul className="space-y-2.5">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <Check size={14} className="text-success-500 flex-shrink-0 mt-0.5" />
                          <span className="text-gray-700">{feature}</span>
                        </li>
                      ))}
                      {plan.notIncluded?.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <X size={14} className="text-gray-300 flex-shrink-0 mt-0.5" />
                          <span className="text-gray-400">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Feature Comparison Table */}
      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-heading font-bold text-gray-900 mb-10 text-center">
            Compare all features
          </h2>

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full">
              <thead>
                <tr className="bg-secondary-50 border-b border-gray-200">
                  <th className="text-left py-4 px-5 text-sm font-semibold text-gray-700 w-1/3">Feature</th>
                  {plans.map((plan) => (
                    <th key={plan.name} className="text-center py-4 px-3 text-sm font-semibold text-gray-700">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {featureComparison.map((row, i) => (
                  <tr key={row.feature} className={i % 2 === 0 ? 'bg-white' : 'bg-secondary-50/50'}>
                    <td className="py-3 px-5 text-sm text-gray-700">{row.feature}</td>
                    <td className="py-3 px-3 text-center"><FeatureCell value={row.starter} /></td>
                    <td className="py-3 px-3 text-center"><FeatureCell value={row.professional} /></td>
                    <td className="py-3 px-3 text-center"><FeatureCell value={row.scale} /></td>
                    <td className="py-3 px-3 text-center"><FeatureCell value={row.enterprise} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Enterprise CTA */}
      <section
        ref={ref}
        className="py-20 bg-gradient-to-br from-secondary-900 to-primary-900 relative overflow-hidden"
      >
        <div className="absolute inset-0 hero-pattern opacity-20" />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="relative max-w-3xl mx-auto px-4 text-center"
        >
          <Crown size={40} className="text-primary-400 mx-auto mb-6" />
          <h2 className="text-3xl sm:text-4xl font-heading font-bold text-white mb-4">
            Need something custom?
          </h2>
          <p className="text-secondary-300 text-lg mb-8 max-w-xl mx-auto">
            On-premise deployment, custom SLAs, professional services, and dedicated engineering support. Let's talk.
          </p>
          <Link
            to="/contact?inquiry=enterprise"
            className="btn-primary inline-flex items-center gap-2 text-base"
            onClick={() => trackEvent('cta_click', { button: 'enterprise_contact', location: 'pricing_bottom' })}
          >
            Contact enterprise sales <ArrowRight size={16} />
          </Link>
        </motion.div>
      </section>
    </div>
  )
}
