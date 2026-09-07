import React from 'react'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import { Mail, Download, Newspaper, Calendar } from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

const pressReleases = [
  {
    date: 'September 2026',
    title: 'FuzeOne launches public website and unified pricing across all 10 products',
    excerpt:
      'FuzeOne introduces a single entry point for its full product family — FuzeFront, FuzeAgent, FuzeSocial, FuzeFinance, and more — with transparent, unified pricing.',
  },
  {
    date: 'General Availability',
    title: 'FuzeFront Platform reaches general availability',
    excerpt:
      'The Module Federation host shell behind the FuzeOne family is now generally available, bringing enterprise auth, billing, and AI to every product built on it.',
  },
]

const factSheet = [
  { label: 'Founded', value: '2026' },
  { label: 'Headquarters', value: 'United States (remote-first)' },
  { label: 'Products', value: '10, one platform' },
  { label: 'Incorporation', value: 'FuzeOne, Inc.' },
]

export const PressPage: React.FC = () => {
  const [heroRef, heroInView] = useInView({ triggerOnce: true, threshold: 0.1 })
  const { trackEvent } = useAnalytics()

  return (
    <div>
      {/* Hero */}
      <section
        ref={heroRef}
        className="relative pt-32 pb-20 bg-gradient-to-br from-secondary-900 via-secondary-800 to-primary-900 hero-pattern overflow-hidden"
      >
        <div className="absolute top-10 right-1/4 w-80 h-80 bg-accent-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl sm:text-5xl font-heading font-extrabold text-white mb-6">
              Press &amp; <span className="gradient-text">Media</span>
            </h1>
            <p className="text-lg sm:text-xl text-secondary-300 max-w-2xl mx-auto leading-relaxed">
              News, announcements, and resources for journalists and media covering FuzeOne.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Press releases */}
      <section className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-heading font-bold text-gray-900 mb-10 flex items-center gap-3">
            <Newspaper size={24} className="text-primary-600" />
            Latest news
          </h2>
          <div className="space-y-6">
            {pressReleases.map((release) => (
              <div
                key={release.title}
                className="bg-secondary-50 rounded-2xl border border-secondary-100 p-6"
              >
                <div className="flex items-center gap-2 text-xs font-medium text-primary-600 uppercase tracking-wider mb-2">
                  <Calendar size={13} /> {release.date}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{release.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{release.excerpt}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Fact sheet + media kit */}
      <section className="py-24 bg-secondary-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-2 gap-10">
          <div>
            <h2 className="text-2xl font-heading font-bold text-gray-900 mb-6">Fact sheet</h2>
            <dl className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 shadow-soft">
              {factSheet.map((item) => (
                <div key={item.label} className="flex justify-between px-5 py-4">
                  <dt className="text-sm text-gray-500">{item.label}</dt>
                  <dd className="text-sm font-medium text-gray-900">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h2 className="text-2xl font-heading font-bold text-gray-900 mb-6">Media kit</h2>
            <div className="bg-white rounded-2xl border border-gray-200 shadow-soft p-6">
              <p className="text-sm text-gray-600 leading-relaxed mb-5">
                Logos, brand colors, and product screenshots for editorial use. For a custom asset
                or interview request, reach out to our press team directly.
              </p>
              <div className="flex flex-col gap-3">
                <a
                  href="/logo-icon.svg"
                  download
                  className="btn-secondary flex items-center justify-center gap-2 text-sm"
                  onClick={() => trackEvent('press_kit_download', { asset: 'logo' })}
                >
                  <Download size={16} /> Download logo
                </a>
                <a
                  href="mailto:press@fuzefront.com"
                  className="btn-primary flex items-center justify-center gap-2 text-sm"
                  onClick={() => trackEvent('press_contact_click', { location: 'media_kit' })}
                >
                  <Mail size={16} /> Contact press team
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-16 bg-white border-t border-secondary-100">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <p className="text-gray-600">
            For all press inquiries, contact{' '}
            <a href="mailto:press@fuzefront.com" className="text-primary-600 hover:underline font-medium">
              press@fuzefront.com
            </a>
          </p>
        </div>
      </section>
    </div>
  )
}
