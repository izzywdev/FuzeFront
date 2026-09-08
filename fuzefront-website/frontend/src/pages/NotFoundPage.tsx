import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Home, Search } from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

const helpfulLinks = [
  { name: 'Products', href: '/products' },
  { name: 'Pricing', href: '/pricing' },
  { name: 'About', href: '/about' },
  { name: 'Contact', href: '/contact' },
]

export const NotFoundPage: React.FC = () => {
  const { trackEvent } = useAnalytics()

  return (
    <div className="relative min-h-[80vh] flex items-center bg-gradient-to-br from-secondary-900 via-secondary-800 to-primary-900 hero-pattern overflow-hidden pt-16">
      <div className="absolute top-1/4 left-1/4 w-80 h-80 bg-primary-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-accent-600/15 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 text-center py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="text-7xl sm:text-8xl font-heading font-extrabold gradient-text mb-4">
            404
          </div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-white mb-4">
            This page doesn't exist
          </h1>
          <p className="text-secondary-300 max-w-md mx-auto mb-10">
            The page you're looking for may have been moved, renamed, or never existed.
            Let's get you back on track.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link
              to="/"
              className="btn-primary flex items-center justify-center gap-2"
              onClick={() => trackEvent('cta_click', { button: '404_home', location: '404_page' })}
            >
              <Home size={18} /> Back to home
            </Link>
            <Link
              to="/contact"
              className="btn-ghost flex items-center justify-center gap-2"
              onClick={() => trackEvent('cta_click', { button: '404_contact', location: '404_page' })}
            >
              Contact us <ArrowRight size={16} />
            </Link>
          </div>

          <div className="flex items-center justify-center gap-2 text-secondary-500 text-sm mb-4">
            <Search size={14} /> Or try one of these
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {helpfulLinks.map((link) => (
              <Link
                key={link.name}
                to={link.href}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-sm font-medium text-white transition-colors duration-200"
                onClick={() => trackEvent('404_helpful_link_click', { link: link.name })}
              >
                {link.name}
              </Link>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
