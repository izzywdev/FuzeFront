import React, { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X, ChevronDown, ExternalLink } from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

const productLinks = [
  { name: 'FuzeFront Platform', href: '/products/fuzefront', desc: 'Module Federation host shell' },
  { name: 'FuzeAgent', href: '/products/fuzeagent', desc: 'AI team orchestration' },
  { name: 'FuzeSocial', href: '/products/fuzesocial', desc: 'Social media automation' },
  { name: 'FuzeFinance', href: '/products/fuzefinance', desc: 'Enterprise finance & accounting' },
  { name: 'FuzeKeys', href: '/products/fuzekeys', desc: 'AI-powered credential management' },
  { name: 'FuzeMarket', href: '/products/fuzemarket', desc: 'Marketing & SEO intelligence' },
  { name: 'FuzeQuality', href: '/products/fuzequality', desc: 'Evidence graph & QA' },
  { name: 'FuzeBI', href: '/products/fuzebi', desc: 'Business intelligence' },
  { name: 'FuzeX', href: '/products/fuzex', desc: 'Design & workflow studio' },
  { name: 'FuzeHub', href: '/products/fuzehub', desc: 'Unified operations hub' },
]

const industryLinks = [
  { name: 'FinTech & Financial Services', href: '/industries#fintech' },
  { name: 'HealthTech & Healthcare', href: '/industries#healthtech' },
  { name: 'E-commerce & Retail', href: '/industries#ecommerce' },
  { name: 'Legal Tech', href: '/industries#legaltech' },
  { name: 'EdTech', href: '/industries#edtech' },
  { name: 'SaaS Platforms', href: '/industries#saas' },
  { name: 'Agencies & Consultancies', href: '/industries#agencies' },
  { name: 'Enterprise IT', href: '/industries#enterprise' },
]

const navigation = [
  { name: 'Products', href: '/products', submenu: productLinks, wide: true },
  { name: 'Industries', href: '/industries', submenu: industryLinks, wide: false },
  { name: 'Pricing', href: '/pricing' },
  { name: 'About', href: '/about' },
  { name: 'Blog', href: '/blog' },
  { name: 'Contact', href: '/contact' },
]

export const Header: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const location = useLocation()
  const { trackEvent } = useAnalytics()

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    setIsOpen(false)
    setActiveDropdown(null)
  }, [location])

  const handleNavClick = (navItem: string) => {
    trackEvent('navigation_click', { item: navItem, page: location.pathname })
  }

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      isScrolled
        ? 'bg-white/95 backdrop-blur-md shadow-soft border-b border-gray-100'
        : 'bg-transparent'
    }`}>
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link
            to="/"
            className="flex items-center space-x-2"
            onClick={() => handleNavClick('logo')}
          >
            <div className="w-9 h-9 bg-gradient-to-br from-primary-600 to-accent-600 rounded-xl flex items-center justify-center shadow-md">
              <span className="text-white font-bold text-sm tracking-tight">F1</span>
            </div>
            <span className="font-heading font-bold text-xl text-gray-900">
              FuzeOne
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center space-x-6">
            {navigation.map((item) => (
              <div
                key={item.name}
                className="relative"
                onMouseEnter={() => item.submenu && setActiveDropdown(item.name)}
                onMouseLeave={() => setActiveDropdown(null)}
              >
                {item.submenu ? (
                  <>
                    <Link
                      to={item.href}
                      className={`flex items-center space-x-1 font-medium transition-colors duration-200 ${
                        location.pathname.startsWith(item.href)
                          ? 'text-primary-600'
                          : isScrolled
                          ? 'text-gray-700 hover:text-primary-600'
                          : 'text-gray-900 hover:text-primary-600'
                      }`}
                      onClick={() => handleNavClick(item.name)}
                    >
                      <span>{item.name}</span>
                      <ChevronDown size={14} className={`transition-transform duration-200 ${
                        activeDropdown === item.name ? 'rotate-180' : ''
                      }`} />
                    </Link>

                    <AnimatePresence>
                      {activeDropdown === item.name && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                          transition={{ duration: 0.15 }}
                          className={`absolute top-full left-0 mt-2 bg-white rounded-xl shadow-hard border border-gray-100 py-3 ${
                            item.wide ? 'w-72' : 'w-56'
                          }`}
                        >
                          {item.submenu.map((subItem) => (
                            <Link
                              key={subItem.name}
                              to={subItem.href}
                              className="block px-4 py-2.5 hover:bg-primary-50 transition-colors duration-150 group"
                              onClick={() => handleNavClick(`${item.name} - ${subItem.name}`)}
                            >
                              <div className="text-sm font-medium text-gray-800 group-hover:text-primary-600">
                                {subItem.name}
                              </div>
                              {'desc' in subItem && (
                                <div className="text-xs text-gray-500 mt-0.5">{(subItem as { name: string; href: string; desc: string }).desc}</div>
                              )}
                            </Link>
                          ))}
                          {item.name === 'Products' && (
                            <div className="border-t border-gray-100 mt-2 pt-2 px-4">
                              <Link
                                to="/products"
                                className="text-xs font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1"
                              >
                                View all products <ExternalLink size={10} />
                              </Link>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                ) : (
                  <Link
                    to={item.href}
                    className={`font-medium transition-colors duration-200 ${
                      location.pathname === item.href
                        ? 'text-primary-600'
                        : isScrolled
                        ? 'text-gray-700 hover:text-primary-600'
                        : 'text-gray-900 hover:text-primary-600'
                    }`}
                    onClick={() => handleNavClick(item.name)}
                  >
                    {item.name}
                  </Link>
                )}
              </div>
            ))}
          </div>

          {/* Auth Buttons */}
          <div className="hidden lg:flex items-center space-x-3">
            <a
              href="https://app.fuzefront.com/auth/login"
              className={`font-medium px-4 py-2 rounded-lg text-sm transition-colors duration-200 ${
                isScrolled
                  ? 'text-gray-700 hover:text-primary-600 hover:bg-primary-50'
                  : 'text-gray-800 hover:text-primary-600'
              }`}
              onClick={() => trackEvent('cta_click', { button: 'sign_in', location: 'header' })}
            >
              Sign In
            </a>
            <a
              href="https://app.fuzefront.com/auth/register"
              className="btn-primary text-sm py-2 px-5"
              onClick={() => trackEvent('cta_click', { button: 'sign_up', location: 'header' })}
            >
              Sign Up Free
            </a>
          </div>

          {/* Mobile menu button */}
          <div className="lg:hidden">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-700 hover:text-primary-600 hover:bg-gray-100 transition-colors duration-200"
              aria-label={isOpen ? 'Close menu' : 'Open menu'}
            >
              {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="lg:hidden bg-white border-t border-gray-100 overflow-hidden"
            >
              <div className="px-2 pt-2 pb-4 space-y-1">
                {navigation.map((item) => (
                  <div key={item.name}>
                    <Link
                      to={item.href}
                      className={`block px-3 py-2 rounded-md text-base font-medium transition-colors duration-200 ${
                        location.pathname.startsWith(item.href)
                          ? 'text-primary-600 bg-primary-50'
                          : 'text-gray-700 hover:text-primary-600 hover:bg-gray-50'
                      }`}
                      onClick={() => handleNavClick(item.name)}
                    >
                      {item.name}
                    </Link>
                    {item.submenu && (
                      <div className="ml-4 mt-1 space-y-0.5">
                        {item.submenu.slice(0, 5).map((subItem) => (
                          <Link
                            key={subItem.name}
                            to={subItem.href}
                            className="block px-3 py-1.5 text-sm text-gray-600 hover:text-primary-600 hover:bg-gray-50 rounded-md transition-colors duration-200"
                            onClick={() => handleNavClick(`${item.name} - ${subItem.name}`)}
                          >
                            {subItem.name}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div className="pt-4 border-t border-gray-100 space-y-2">
                  <a
                    href="https://app.fuzefront.com/auth/login"
                    className="block w-full text-center px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    onClick={() => trackEvent('cta_click', { button: 'sign_in', location: 'header_mobile' })}
                  >
                    Sign In
                  </a>
                  <a
                    href="https://app.fuzefront.com/auth/register"
                    className="block w-full text-center btn-primary text-sm"
                    onClick={() => trackEvent('cta_click', { button: 'sign_up', location: 'header_mobile' })}
                  >
                    Sign Up Free
                  </a>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </header>
  )
}
