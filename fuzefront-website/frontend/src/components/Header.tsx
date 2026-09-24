import React, { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { Logo, NavLink as DSNavLink } from '@fuzefront/design-system'
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

// The header is ALWAYS a solid, DS-token-driven surface (--bg-secondary /
// --text-* / --accent-color) — never transparent. It previously swapped
// between a transparent+white-text state and a white+dark-text state based
// on scroll position, and anything that broke that scroll listener (or a
// page whose content isn't a dark hero at the top) left white-on-white or
// otherwise invisible nav text. A permanently solid, token-colored bar
// removes that failure mode entirely rather than patching one instance of
// it, and keeps the header on the same shared palette as the rest of the
// Fuze family instead of a site-local Tailwind palette.
export const Header: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
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
  }, [location])

  const handleNavClick = (navItem: string) => {
    trackEvent('navigation_click', { item: navItem, page: location.pathname })
  }

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] transition-shadow duration-300 ${
        isScrolled ? 'shadow-[0_4px_20px_var(--shadow)]' : ''
      }`}
    >
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link
            to="/"
            className="flex items-center space-x-2"
            onClick={() => handleNavClick('logo')}
          >
            <Logo src="/logo-icon.svg" name="FuzeOne" size="md" style={{ width: 36, height: 36 }} />
            <span className="font-heading font-bold text-xl text-[var(--text-primary)]">
              FuzeOne
            </span>
          </Link>

          {/* Desktop Navigation — the @fuzefront/design-system NavLink primitive
              (#927): a real router-aware anchor with active-state underline and,
              for Products/Industries, a hover/focus disclosure submenu. This
              replaced a hand-rolled Tailwind implementation that duplicated
              MenuItem's active-underline treatment without a shared component;
              NavLink owns the hover/focus/Escape/aria-expanded wiring now. */}
          <div className="hidden lg:flex items-center gap-1">
            {navigation.map((item) => (
              <DSNavLink
                key={item.name}
                as={Link}
                to={item.href}
                submenuAs={Link}
                label={item.name}
                active={
                  item.submenu
                    ? location.pathname.startsWith(item.href)
                    : location.pathname === item.href
                }
                onClick={() => handleNavClick(item.name)}
                submenu={item.submenu?.map((subItem) => ({
                  key: subItem.href,
                  label: subItem.name,
                  to: subItem.href,
                  description: 'desc' in subItem ? subItem.desc : undefined,
                  onClick: () => handleNavClick(`${item.name} - ${subItem.name}`),
                }))}
              />
            ))}
          </div>

          {/* Auth Buttons */}
          <div className="hidden lg:flex items-center space-x-3">
            <a
              href="https://app.fuzefront.com/login"
              className="font-medium px-4 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-quaternary)] transition-colors duration-200"
              onClick={() => trackEvent('cta_click', { button: 'sign_in', location: 'header' })}
            >
              Sign In
            </a>
            <a
              href="https://app.fuzefront.com/signup"
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
              /* p-2 (24px icon + 8px padding each side = 40px) sits under the
                 44px WCAG 2.5.5 tap-target minimum — caught by
                 e2e/post-prod/mobile-responsive.spec.ts. p-2.5 makes it 44px
                 exactly. */
              className="inline-flex items-center justify-center p-2.5 rounded-md text-[var(--text-primary)] hover:text-[var(--accent-color)] hover:bg-[var(--bg-quaternary)] transition-colors duration-200"
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
              className="lg:hidden bg-[var(--bg-secondary)] border-t border-[var(--border-color)] overflow-hidden"
            >
              <div className="px-2 pt-2 pb-4 space-y-1">
                {navigation.map((item) => (
                  <div key={item.name}>
                    <Link
                      to={item.href}
                      /* py-2 (text-base's 24px line-height + 8px padding each
                         side = 40px) sits under the 44px WCAG 2.5.5
                         tap-target minimum — caught by
                         e2e/post-prod/mobile-responsive.spec.ts. py-2.5 makes
                         it 44px exactly. */
                      className={`block px-3 py-2.5 rounded-md text-base font-medium transition-colors duration-200 ${
                        location.pathname.startsWith(item.href)
                          ? 'text-[var(--text-primary)] bg-[var(--accent-soft)]'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-quaternary)]'
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
                            className="block px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-quaternary)] rounded-md transition-colors duration-200"
                            onClick={() => handleNavClick(`${item.name} - ${subItem.name}`)}
                          >
                            {subItem.name}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div className="pt-4 border-t border-[var(--border-color)] space-y-2">
                  <a
                    href="https://app.fuzefront.com/login"
                    className="block w-full text-center px-4 py-2 text-sm font-medium text-[var(--text-secondary)] border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-quaternary)] transition-colors"
                    onClick={() => trackEvent('cta_click', { button: 'sign_in', location: 'header_mobile' })}
                  >
                    Sign In
                  </a>
                  <a
                    href="https://app.fuzefront.com/signup"
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
