import React, { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X, ChevronDown } from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

const navigation = [
  { name: 'Home', href: '/' },
  { 
    name: 'Products', 
    href: '/products',
    submenu: [
      { name: 'FuzeFront Platform', href: '/products#platform' },
      { name: 'FuzeInfra', href: '/products#infrastructure' },
      { name: 'Authentication & Authorization', href: '/products#auth' },
      { name: 'AI Chat Assistant', href: '/products#ai-chat' },
      { name: 'Billing & Payments', href: '/products#billing' },
    ]
  },
  { 
    name: 'Solutions', 
    href: '/solutions',
    submenu: [
      { name: 'Enterprise SaaS', href: '/solutions#enterprise' },
      { name: 'Startup MVP', href: '/solutions#startup' },
      { name: 'Migration Services', href: '/solutions#migration' },
      { name: 'Custom Development', href: '/solutions#custom' },
    ]
  },
  { name: 'Pricing', href: '/pricing' },
  { name: 'About', href: '/about' },
  { name: 'Contact', href: '/contact' },
]

export const Header: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const location = useLocation()
  const { trackEvent } = useAnalytics()

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }

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

  const handleCTAClick = () => {
    trackEvent('cta_click', { location: 'header', page: location.pathname })
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
            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">F</span>
            </div>
            <span className="font-heading font-bold text-xl text-gray-900">
              FuzeFront
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center space-x-8">
            {navigation.map((item) => (
              <div key={item.name} className="relative group">
                {item.submenu ? (
                  <div
                    className="flex items-center space-x-1 cursor-pointer"
                    onMouseEnter={() => setActiveDropdown(item.name)}
                    onMouseLeave={() => setActiveDropdown(null)}
                  >
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
                    <ChevronDown size={16} className={`transition-transform duration-200 ${
                      activeDropdown === item.name ? 'rotate-180' : ''
                    }`} />
                    
                    {/* Dropdown Menu */}
                    <AnimatePresence>
                      {activeDropdown === item.name && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          transition={{ duration: 0.2 }}
                          className="absolute top-full left-0 mt-2 w-64 bg-white rounded-lg shadow-hard border border-gray-100 py-2"
                          onMouseEnter={() => setActiveDropdown(item.name)}
                          onMouseLeave={() => setActiveDropdown(null)}
                        >
                          {item.submenu.map((subItem) => (
                            <Link
                              key={subItem.name}
                              to={subItem.href}
                              className="block px-4 py-2 text-sm text-gray-700 hover:bg-primary-50 hover:text-primary-600 transition-colors duration-200"
                              onClick={() => handleNavClick(`${item.name} - ${subItem.name}`)}
                            >
                              {subItem.name}
                            </Link>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
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

          {/* CTA Button */}
          <div className="hidden lg:flex items-center space-x-4">
            <Link
              to="/contact"
              className="btn-primary"
              onClick={handleCTAClick}
            >
              Get Started
            </Link>
          </div>

          {/* Mobile menu button */}
          <div className="lg:hidden">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-700 hover:text-primary-600 hover:bg-gray-100 transition-colors duration-200"
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
              transition={{ duration: 0.3 }}
              className="lg:hidden bg-white border-t border-gray-100 overflow-hidden"
            >
              <div className="px-2 pt-2 pb-3 space-y-1">
                {navigation.map((item) => (
                  <div key={item.name}>
                    <Link
                      to={item.href}
                      className={`block px-3 py-2 rounded-md text-base font-medium transition-colors duration-200 ${
                        location.pathname === item.href
                          ? 'text-primary-600 bg-primary-50'
                          : 'text-gray-700 hover:text-primary-600 hover:bg-gray-50'
                      }`}
                      onClick={() => handleNavClick(item.name)}
                    >
                      {item.name}
                    </Link>
                    {item.submenu && (
                      <div className="ml-4 mt-1 space-y-1">
                        {item.submenu.map((subItem) => (
                          <Link
                            key={subItem.name}
                            to={subItem.href}
                            className="block px-3 py-1 text-sm text-gray-600 hover:text-primary-600 transition-colors duration-200"
                            onClick={() => handleNavClick(`${item.name} - ${subItem.name}`)}
                          >
                            {subItem.name}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div className="pt-4 border-t border-gray-100">
                  <Link
                    to="/contact"
                    className="block w-full text-center btn-primary"
                    onClick={handleCTAClick}
                  >
                    Get Started
                  </Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </header>
  )
}