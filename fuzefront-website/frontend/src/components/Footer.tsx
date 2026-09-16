import React from 'react'
import { Link } from 'react-router-dom'
import { Mail, Github, Twitter, Linkedin, Youtube } from 'lucide-react'
import { Logo } from '@fuzefront/design-system'
import { useAnalytics } from '../contexts/AnalyticsContext'

const footerNavigation = {
  products: [
    { name: 'FuzeFront Platform', href: '/products/fuzefront' },
    { name: 'FuzeAgent', href: '/products/fuzeagent' },
    { name: 'FuzeSocial', href: '/products/fuzesocial' },
    { name: 'FuzeFinance', href: '/products/fuzefinance' },
    { name: 'FuzeKeys', href: '/products/fuzekeys' },
    { name: 'FuzeBI', href: '/products/fuzebi' },
    { name: 'FuzeHub', href: '/products/fuzehub' },
    { name: 'FuzeX', href: '/products/fuzex' },
  ],
  company: [
    { name: 'About', href: '/about' },
    { name: 'Blog', href: '/blog' },
    { name: 'Careers', href: '/careers' },
    { name: 'Press', href: '/press' },
    { name: 'Contact', href: '/contact' },
  ],
  legal: [
    { name: 'Privacy Policy', href: '/privacy' },
    { name: 'Terms of Service', href: '/terms' },
  ],
  resources: [
    { name: 'Documentation', href: '/docs' },
    { name: 'GitHub', href: 'https://github.com/izzywdev/FuzeFront' },
    { name: 'Status', href: '/status' },
    { name: 'API Reference', href: 'https://developers.fuzefront.com' },
  ],
}

const socialLinks = [
  { name: 'GitHub', href: 'https://github.com/izzywdev/FuzeFront', icon: Github },
  { name: 'Twitter', href: 'https://twitter.com/fuzeone', icon: Twitter },
  { name: 'LinkedIn', href: 'https://linkedin.com/company/fuzeone', icon: Linkedin },
  { name: 'YouTube', href: 'https://youtube.com/fuzeone', icon: Youtube },
]

export const Footer: React.FC = () => {
  const { trackEvent } = useAnalytics()

  const handleFooterClick = (section: string, item: string) => {
    trackEvent('footer_click', { section, item })
  }

  const handleSocialClick = (platform: string) => {
    trackEvent('social_click', { platform, location: 'footer' })
  }

  return (
    <footer className="bg-[var(--bg-secondary)] text-[var(--text-primary)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-8 lg:gap-12">
          {/* Company Info */}
          <div className="lg:col-span-2">
            <Link to="/" className="flex items-center space-x-2 mb-5">
              <Logo src="/logo-icon.svg" name="FuzeOne" size="md" style={{ width: 36, height: 36 }} />
              <span className="font-heading font-bold text-xl text-[var(--text-primary)]">FuzeOne</span>
            </Link>
            <p className="text-[var(--text-secondary)] mb-6 text-sm leading-relaxed max-w-sm">
              The operating system for your SaaS. Enterprise auth, billing, AI, and
              Module Federation architecture — all in one platform.
            </p>
            <div className="flex items-center space-x-3 mb-6">
              <Mail size={15} className="text-[var(--accent-color)] flex-shrink-0" />
              <a
                href="mailto:contact@fuzefront.com"
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-sm"
                onClick={() => handleFooterClick('contact', 'email')}
              >
                contact@fuzefront.com
              </a>
            </div>
            <div className="flex space-x-4">
              {socialLinks.map((item) => {
                const Icon = item.icon
                return (
                  <a
                    key={item.name}
                    href={item.href}
                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={item.name}
                    onClick={() => handleSocialClick(item.name)}
                  >
                    <Icon size={18} />
                  </a>
                )
              })}
            </div>
          </div>

          {/* Products */}
          <div>
            <h3 className="font-semibold text-[var(--text-primary)] mb-4 text-sm uppercase tracking-wider">Products</h3>
            <ul className="space-y-2.5">
              {footerNavigation.products.map((item) => (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-sm"
                    onClick={() => handleFooterClick('products', item.name)}
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="font-semibold text-[var(--text-primary)] mb-4 text-sm uppercase tracking-wider">Company</h3>
            <ul className="space-y-2.5">
              {footerNavigation.company.map((item) => (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-sm"
                    onClick={() => handleFooterClick('company', item.name)}
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold text-[var(--text-primary)] mb-4 text-sm uppercase tracking-wider">Legal</h3>
            <ul className="space-y-2.5">
              {footerNavigation.legal.map((item) => (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-sm"
                    onClick={() => handleFooterClick('legal', item.name)}
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="font-semibold text-[var(--text-primary)] mb-4 text-sm uppercase tracking-wider">Resources</h3>
            <ul className="space-y-2.5">
              {footerNavigation.resources.map((item) => (
                <li key={item.name}>
                  {item.href.startsWith('http') ? (
                    <a
                      href={item.href}
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-sm"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => handleFooterClick('resources', item.name)}
                    >
                      {item.name}
                    </a>
                  ) : (
                    <Link
                      to={item.href}
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-sm"
                      onClick={() => handleFooterClick('resources', item.name)}
                    >
                      {item.name}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 pt-8 border-t border-[var(--border-color)] flex flex-col md:flex-row justify-between items-center gap-4">
          {/* --text-tertiary here fails WCAG AA (3.7:1 vs the 4.5:1 this
              14px text needs) against --bg-secondary — caught by
              e2e/contrast.spec.ts. --text-secondary clears it. */}
          <p className="text-[var(--text-secondary)] text-sm">
            &copy; 2026 FuzeOne, Inc. All rights reserved.
          </p>
          <div className="flex items-center space-x-6">
            <Link
              to="/privacy"
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-sm"
              onClick={() => handleFooterClick('bottom', 'privacy')}
            >
              Privacy
            </Link>
            <Link
              to="/terms"
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-sm"
              onClick={() => handleFooterClick('bottom', 'terms')}
            >
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
